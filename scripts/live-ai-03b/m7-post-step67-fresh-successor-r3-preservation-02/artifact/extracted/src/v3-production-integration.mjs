import { verifyExecutorAttestationV2,EXECUTOR_ATTESTATION_CONTRACT_V2,EXECUTOR_ATTESTATION_ISSUER_V2 } from './executor-attestation-v2.mjs';
import { validateRuntimePreservationBinding } from './v3-runtime-identity.mjs';
const fail=reason=>({ok:false,reason});
export const V3_EXECUTOR_ATTESTATION_CONTRACT=EXECUTOR_ATTESTATION_CONTRACT_V2;
export const V3_EXECUTOR_ATTESTER_ISSUER=EXECUTOR_ATTESTATION_ISSUER_V2;
export function validateV3ProductionExecutorAuthority({executorAttestation,executorTrustRoot,expectedConnectionToken,expectedRequestNonce,now,runtimePreservationBinding}={}){
 const pin=validateRuntimePreservationBinding(runtimePreservationBinding);if(!pin.ok)return fail(pin.reason);
 const ex=verifyExecutorAttestationV2(executorAttestation,{trustRoot:executorTrustRoot,expectedConnectionToken,expectedRequestNonce,now});if(!ex.ok)return ex;
 return {ok:true,executorAttestation:ex.attestation,successorRuntimePinRef:pin.pinRef};
}
