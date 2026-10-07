// Reader-only extraction of the accepted Reader V2 binding semantics.
// Deliberately avoids importing the historical combined role-binding module, so no Executor Attestation V1
// verifier is loaded into the V3 composition graph.
import { CONNECTION_IDENTITY_PROOF_CONTRACT, verifyConnectionTargetBinding } from '../../trusted-executor-runtime-01/db-target-binding.mjs';
import { verifyReaderAttestation } from '../../private-reader-production-integration-offline-01/reader-attestation.mjs';
import { READER_ROLE } from '../../private-reader-host-runtime-offline-01/reader-only-authority.mjs';
import { FIXED_V3 } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs';

const fail=reason=>({ok:false,reason});
function checkRootMode(trustRoot,testBoundary){
  if(!trustRoot||typeof trustRoot!=='object')return fail('attester_trust_root_absent');
  if(!testBoundary&&trustRoot.test===true)return fail('attester_trust_root_is_test_only');
  if(testBoundary&&trustRoot.test!==true)return fail('test_boundary_requires_test_attester');
  return {ok:true};
}
export function bindReaderConnectionV2Only({session,envelope,trustRoot,requestNonce,nowMs,testBoundary}){
  const rm=checkRootMode(trustRoot,testBoundary===true);if(!rm.ok)return rm;
  if(!session||!session.identity||typeof session.token!=='string')return fail('reader_session_absent');
  const v=verifyReaderAttestation(envelope,{trustRoot,expectedConnectionToken:session.token,expectedRequestNonce:requestNonce,now:nowMs});
  if(!v.ok)return fail('reader_'+v.reason);
  if(v.attestation.connection.role!==READER_ROLE)return fail('reader_attestation_role_mismatch');
  const proof=Object.freeze({
    provenance:testBoundary===true?CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance:CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance,
    issuer:trustRoot.issuer,boundConnectionToken:session.token,
    serviceId:v.attestation.target.pgServiceId,projectId:v.attestation.target.projectId,environmentId:v.attestation.target.environmentId,
  });
  const tb=verifyConnectionTargetBinding({expectedServiceId:FIXED_V3.ai_staging_postgres,expectedIssuer:trustRoot.issuer,connectionToken:session.token,connectionIdentityProof:proof,testBoundary:testBoundary===true});
  if(!tb.ok)return fail('reader_'+tb.reason);
  return {ok:true,binding:Object.freeze({role:READER_ROLE,token:session.token,pid:session.identity.pid,applicationName:session.identity.applicationName,nonce:requestNonce,identityProof:proof,expectedIssuer:trustRoot.issuer,privileges:v.attestation.privileges,statementTimeoutMs:session.effectiveStatementTimeoutMs})};
}
