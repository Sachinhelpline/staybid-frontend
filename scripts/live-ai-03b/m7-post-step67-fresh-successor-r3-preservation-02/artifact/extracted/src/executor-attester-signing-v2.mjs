import { createPrivateKey,createPublicKey,sign as edSign } from 'node:crypto';
import { canonicalize,publicKeyFingerprintFromDerB64 } from './pricing-approval-contract-v3.mjs';
import { EXECUTOR_ATTESTATION_CONTRACT_V2,EXECUTOR_ATTESTATION_DOMAIN_V2,EXECUTOR_ATTESTATION_ISSUER_V2,ATTESTATION_MAX_LIFETIME_MS } from './executor-attestation-v2.mjs';
import { isEvaluatedExecutorEvidenceV2 } from './executor-evidence-policy-v2.mjs';
const fail=reason=>({ok:false,reason});
export function createExecutorSigningAdapterV2({privateKeyPkcs8B64,expectedPublicKeyDerB64,expectedFingerprint,readerAttesterFingerprint,proofLifetimeMs,nowProvider=Date.now}){
 if(!Number.isInteger(proofLifetimeMs)||proofLifetimeMs<1000||proofLifetimeMs>ATTESTATION_MAX_LIFETIME_MS)return fail('proof_lifetime_invalid');
 let key,publicKeyDerB64,keyId;try{key=createPrivateKey({key:Buffer.from(String(privateKeyPkcs8B64),'base64'),format:'der',type:'pkcs8'});if(key.asymmetricKeyType!=='ed25519')return fail('signing_key_not_ed25519');publicKeyDerB64=createPublicKey(key).export({type:'spki',format:'der'}).toString('base64');keyId=publicKeyFingerprintFromDerB64(publicKeyDerB64);}catch{return fail('signing_key_invalid');}
 if(publicKeyDerB64!==expectedPublicKeyDerB64||keyId!==expectedFingerprint)return fail('signing_key_not_configured_identity');
 if(typeof readerAttesterFingerprint!=='string'||readerAttesterFingerprint===keyId)return fail('signing_key_not_distinct_from_reader_attester');
 function issue({requestNonce,evidence}){
  if(typeof requestNonce!=='string'||!/^[0-9a-f]{32}$/.test(requestNonce))return fail('request_nonce_invalid');
  if(!isEvaluatedExecutorEvidenceV2(evidence))return fail('evidence_not_independently_evaluated');
  const t=nowProvider();if(!Number.isSafeInteger(t))return fail('clock_invalid');
  if(Math.abs(t-evidence.dbNowMs)>5000)return fail('attester_clock_skew_at_issue');
  const payload={contract:EXECUTOR_ATTESTATION_CONTRACT_V2,domain:EXECUTOR_ATTESTATION_DOMAIN_V2,issuer:EXECUTOR_ATTESTATION_ISSUER_V2,keyId,issuedAtMs:t,expiresAtMs:t+proofLifetimeMs,requestNonce,target:{...evidence.target},connection:{...evidence.connection},privileges:{...evidence.privileges,roleMemberships:[...evidence.privileges.roleMemberships],schemaCreate:[...evidence.privileges.schemaCreate],trustedSchemaUsage:[...evidence.privileges.trustedSchemaUsage],executableRoutines:[...evidence.privileges.executableRoutines]}};
  let signatureB64;try{signatureB64=edSign(null,Buffer.from(canonicalize(payload),'utf8'),key).toString('base64');}catch{return fail('signing_failed');}
  return {ok:true,envelope:{payload,signatureB64}};
 }
 return {ok:true,signer:Object.freeze({issuer:EXECUTOR_ATTESTATION_ISSUER_V2,keyId,publicKeyDerB64,proofLifetimeMs,issue})};
}
