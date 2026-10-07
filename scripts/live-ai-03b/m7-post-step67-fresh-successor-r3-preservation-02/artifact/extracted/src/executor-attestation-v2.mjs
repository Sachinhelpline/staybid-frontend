import { FIXED_V3, canonicalize, verifyEnvelopeSignature } from './pricing-approval-contract-v3.mjs';

export const EXECUTOR_ROLE='live_ai_03b_executor';
export const EXECUTOR_ATTESTATION_CONTRACT_V2='AiStagingExecutorAttestationV2';
export const EXECUTOR_ATTESTATION_DOMAIN_V2='staybid.live-ai-03b.executor-authority-attestation.v2';
export const EXECUTOR_ATTESTATION_ISSUER_V2='staybid.live-ai-03b.executor-attester.v2';
export const ATTESTATION_MAX_LIFETIME_MS=300000;
export const ATTESTATION_FORWARD_TOLERANCE_MS=5000;

export const EXPECTED_EXECUTOR_PRIVILEGES_V2=Object.freeze({
  trustedSchemaUsage:Object.freeze(['live_ai_03b_trusted','live_ai_03b_trusted_v2','live_ai_03b_trusted_v3']),
  executableRoutines:Object.freeze([
    'live_ai_03b_trusted.activate_catalog(jsonb,text)',
    'live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)',
    'live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)',
    'live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)',
    'live_ai_03b_trusted_v3.activate_catalog_v3(jsonb,text)',
    'live_ai_03b_trusted_v3.restore_catalog_v3_inactive(jsonb,text)',
  ])
});
export const EXECUTOR_PRIVILEGE_KEYS_V2=Object.freeze(['budgetTablePrivilegeCount','currentUser','executableRoutines','ledgerPrivilegeCount','publicOrDefaultPrivilegeWidening','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication','rolsuper','roleMemberships','schemaCreate','sessionUser','trustedSchemaUsage','unapprovedRoutineExecute'].sort());
const PAYLOAD_KEYS=['connection','contract','domain','expiresAtMs','issuedAtMs','issuer','keyId','privileges','requestNonce','target'].sort();
const TARGET_KEYS=['environmentId','pgServiceId','projectId'].sort();
const CONNECTION_KEYS=['role','token'].sort();
const fail=reason=>({ok:false,reason});
const exactKeys=(o,k)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&JSON.stringify(Object.keys(o).sort())===JSON.stringify(k);
const sameList=(a,b)=>Array.isArray(a)&&a.every(x=>typeof x==='string')&&new Set(a).size===a.length&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());

export function validateMeasuredExecutorPrivilegesV2(p){
  if(!exactKeys(p,EXECUTOR_PRIVILEGE_KEYS_V2))return fail('executor_privilege_shape_mismatch');
  if(p.currentUser!==EXECUTOR_ROLE||p.sessionUser!==EXECUTOR_ROLE)return fail('executor_drift_wrong_role');
  for(const k of ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'])if(p[k]!==false)return fail('executor_drift_'+k.slice(3));
  if(!Array.isArray(p.roleMemberships)||p.roleMemberships.length!==0)return fail('executor_drift_role_membership');
  if(!Array.isArray(p.schemaCreate)||p.schemaCreate.length!==0)return fail('executor_drift_schema_create');
  if(p.budgetTablePrivilegeCount!==0)return fail('executor_drift_budget_table_privilege');
  if(p.ledgerPrivilegeCount!==0)return fail('executor_drift_ledger_privilege');
  if(!sameList(p.trustedSchemaUsage,EXPECTED_EXECUTOR_PRIVILEGES_V2.trustedSchemaUsage))return fail('executor_drift_schema_usage');
  if(!sameList(p.executableRoutines,EXPECTED_EXECUTOR_PRIVILEGES_V2.executableRoutines))return fail('executor_drift_routine_execute');
  if(p.unapprovedRoutineExecute!==false)return fail('executor_drift_unapproved_routine_execute');
  if(p.publicOrDefaultPrivilegeWidening!==false)return fail('executor_drift_public_or_default_widening');
  return {ok:true};
}

export function verifyExecutorAttestationV2(envelope,{trustRoot,expectedConnectionToken,expectedRequestNonce,now}={}){
  if(!trustRoot||typeof trustRoot.publicKeyDerB64!=='string'||typeof trustRoot.fingerprint!=='string'||typeof trustRoot.issuer!=='string')return fail('executor_trust_root_absent');
  if(trustRoot.issuer!==EXECUTOR_ATTESTATION_ISSUER_V2)return fail('executor_trust_root_issuer_not_v2');
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return fail('executor_attestation_absent');
  const {payload,signatureB64}=envelope;
  if(Object.keys(envelope).sort().join(',')!=='payload,signatureB64'||!exactKeys(payload,PAYLOAD_KEYS))return fail('executor_attestation_malformed');
  if(typeof signatureB64!=='string'||signatureB64.length<16||signatureB64.length>256)return fail('executor_attestation_signature_malformed');
  if(payload.contract!==EXECUTOR_ATTESTATION_CONTRACT_V2||payload.domain!==EXECUTOR_ATTESTATION_DOMAIN_V2)return fail('executor_attestation_contract_mismatch');
  if(!exactKeys(payload.target,TARGET_KEYS)||!exactKeys(payload.connection,CONNECTION_KEYS))return fail('executor_attestation_malformed');
  if(!exactKeys(payload.privileges,EXECUTOR_PRIVILEGE_KEYS_V2))return fail('executor_attestation_malformed');
  try{canonicalize(payload);}catch{return fail('executor_attestation_malformed');}
  if(payload.issuer!==trustRoot.issuer)return fail('executor_attestation_issuer_untrusted');
  if(payload.keyId!==trustRoot.fingerprint)return fail('executor_attestation_key_untrusted');
  if(!verifyEnvelopeSignature(payload,signatureB64,trustRoot.publicKeyDerB64))return fail('executor_attestation_signature_invalid');
  if(!Number.isSafeInteger(now))return fail('clock_absent');
  if(!Number.isSafeInteger(payload.issuedAtMs)||!Number.isSafeInteger(payload.expiresAtMs)||payload.expiresAtMs<=payload.issuedAtMs)return fail('executor_attestation_validity_malformed');
  if(payload.expiresAtMs-payload.issuedAtMs>ATTESTATION_MAX_LIFETIME_MS)return fail('executor_attestation_lifetime_too_long');
  if(payload.issuedAtMs-now>ATTESTATION_FORWARD_TOLERANCE_MS)return fail('executor_attestation_future_dated');
  if(now-payload.issuedAtMs>ATTESTATION_MAX_LIFETIME_MS)return fail('executor_attestation_stale');
  if(now>=payload.expiresAtMs)return fail('executor_attestation_expired');
  if(typeof expectedConnectionToken!=='string'||expectedConnectionToken.length<16)return fail('expected_executor_connection_token_absent');
  if(payload.connection.token!==expectedConnectionToken)return fail('executor_attestation_connection_mismatch');
  if(payload.connection.role!==EXECUTOR_ROLE)return fail('executor_attestation_role_mismatch');
  if(typeof expectedRequestNonce!=='string'||payload.requestNonce!==expectedRequestNonce)return fail('executor_attestation_request_nonce_mismatch');
  const t=payload.target;
  if(t.pgServiceId===FIXED_V3.core_excluded_postgres||t.projectId===FIXED_V3.core_excluded_project)return fail('executor_drift_target_is_core_prod');
  if(t.pgServiceId!==FIXED_V3.ai_staging_postgres||t.projectId!==FIXED_V3.ai_staging_project||t.environmentId!==FIXED_V3.ai_staging_environment)return fail('executor_drift_target_not_ai_staging');
  const pv=validateMeasuredExecutorPrivilegesV2(payload.privileges);if(!pv.ok)return pv;
  return {ok:true,attestation:Object.freeze({...payload,target:Object.freeze({...t}),connection:Object.freeze({...payload.connection}),privileges:Object.freeze({...payload.privileges,roleMemberships:Object.freeze([...payload.privileges.roleMemberships]),schemaCreate:Object.freeze([...payload.privileges.schemaCreate]),trustedSchemaUsage:Object.freeze([...payload.privileges.trustedSchemaUsage]),executableRoutines:Object.freeze([...payload.privileges.executableRoutines])})})};
}
