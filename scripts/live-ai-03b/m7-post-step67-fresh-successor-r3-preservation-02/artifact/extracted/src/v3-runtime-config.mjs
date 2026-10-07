import { EXECUTOR_ATTESTATION_ISSUER_V2 } from './executor-attestation-v2.mjs';
import { publicKeyFingerprintFromDerB64 } from './pricing-approval-contract-v3.mjs';
export const RUNTIME_VERSION='V3';
export const REQUIRED_ENV=Object.freeze({
 version:'LIVE_AI_03B_RUNTIME_CONTRACT_VERSION', reviewerDer:'LIVE_AI_03B_REVIEWER_TRUST_ROOT_DER_B64', reviewerFp:'LIVE_AI_03B_REVIEWER_TRUST_ROOT_FINGERPRINT',
 project:'LIVE_AI_03B_AI_STAGING_PROJECT_ID', environment:'LIVE_AI_03B_AI_STAGING_ENVIRONMENT_ID', pg:'LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID', gateway:'LIVE_AI_03B_AI_STAGING_GATEWAY_SERVICE_ID', connectionRef:'LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF'
});
const TARGETS=Object.freeze({project:'4ad1abb3-823a-4acf-b889-6d34ae46d7f9',environment:'aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc',pg:'b7362594-a01b-4623-a982-394707a6cec2',gateway:'dd96c7cd-02c1-4d02-89eb-7e217930ebfa'});
const fail=(reason,extra)=>({ok:false,reason,...(extra||{})});
export function loadRuntimeConfigV3(env){
 if(!env||typeof env!=='object')return fail('env_absent');const missing=Object.values(REQUIRED_ENV).filter(n=>typeof env[n]!=='string'||!env[n].trim());if(missing.length)return fail('required_env_missing',{missing});
 if(env[REQUIRED_ENV.version]!==RUNTIME_VERSION)return fail('runtime_contract_not_v3');
 for(const [k,v] of Object.entries(TARGETS))if(env[REQUIRED_ENV[k]]!==v)return fail('target_mismatch:'+k);
 let fp;try{fp=publicKeyFingerprintFromDerB64(env[REQUIRED_ENV.reviewerDer]);}catch{return fail('reviewer_key_invalid');}if(fp!==env[REQUIRED_ENV.reviewerFp])return fail('reviewer_fingerprint_mismatch');
 if(env[REQUIRED_ENV.connectionRef]!==EXECUTOR_ATTESTATION_ISSUER_V2)return fail('connection_identity_ref_not_executor_attester_v2');
 return Object.freeze({ok:true,version:RUNTIME_VERSION,targets:TARGETS,reviewer:Object.freeze({pinnedPublicKeyDerB64:env[REQUIRED_ENV.reviewerDer],pinnedFingerprint:fp}),connectionIdentityProofRef:env[REQUIRED_ENV.connectionRef],executorAttestationContract:'AiStagingExecutorAttestationV2'});
}
