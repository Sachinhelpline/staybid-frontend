import { evaluateObservedExecutorEvidenceV2 } from './executor-evidence-policy-v2.mjs';
const fail=reason=>({ok:false,reason});
export const EXECUTOR_OBSERVER_ADAPTER_CONTRACT_V2='StayBidExecutorIndependentObserverAdapterV2';
export function createExecutorAttesterIssuerV2({observerAdapter,signingAdapter}){
 if(!observerAdapter||observerAdapter.contract!==EXECUTOR_OBSERVER_ADAPTER_CONTRACT_V2||typeof observerAdapter.observeExecutorEvidence!=='function')return fail('observer_adapter_invalid');
 if(!signingAdapter||typeof signingAdapter.issue!=='function')return fail('signing_adapter_invalid');
 async function issue(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).sort().join(',')!=='claimedConnectionToken,requestNonce')return fail('bad_request');
  const {requestNonce,claimedConnectionToken}=args;
  if(typeof requestNonce!=='string'||!/^[0-9a-f]{32}$/.test(requestNonce))return fail('request_nonce_invalid');
  if(typeof claimedConnectionToken!=='string'||!/^[0-9a-f]{64}$/.test(claimedConnectionToken))return fail('connection_token_invalid');
  let measured;try{measured=await observerAdapter.observeExecutorEvidence(claimedConnectionToken);}catch{return fail('evidence_unavailable');}
  const ev=evaluateObservedExecutorEvidenceV2(measured);if(!ev.ok)return ev;
  return signingAdapter.issue({requestNonce,evidence:ev.evidence});
 }
 return {ok:true,issuer:Object.freeze({contract:'AiStagingExecutorAttestationIssuerV2',issue})};
}
