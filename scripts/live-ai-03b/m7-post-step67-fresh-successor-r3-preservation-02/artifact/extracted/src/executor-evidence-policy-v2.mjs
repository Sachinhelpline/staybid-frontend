import { FIXED_V3 } from './pricing-approval-contract-v3.mjs';
import { EXECUTOR_ROLE,validateMeasuredExecutorPrivilegesV2 } from './executor-attestation-v2.mjs';
const evaluated=new WeakSet();
const fail=reason=>({ok:false,reason});
export const MAX_ATTESTER_DB_CLOCK_SKEW_MS=5000;
export function evaluateObservedExecutorEvidenceV2(e){
 if(!e||typeof e!=='object'||Array.isArray(e))return fail('evidence_absent');
 const keys=['connection','context','dbNowMs','observedAtMs','privileges','target'];
 if(Object.keys(e).sort().join(',')!==keys.join(','))return fail('evidence_shape_not_exact');
 if(!Number.isSafeInteger(e.observedAtMs)||!Number.isSafeInteger(e.dbNowMs)||Math.abs(e.observedAtMs-e.dbNowMs)>MAX_ATTESTER_DB_CLOCK_SKEW_MS)return fail('attester_clock_skew');
 const t=e.target;if(!t||t.projectId!==FIXED_V3.ai_staging_project||t.environmentId!==FIXED_V3.ai_staging_environment||t.pgServiceId!==FIXED_V3.ai_staging_postgres)return fail('target_not_ai_staging');
 if(t.projectId===FIXED_V3.core_excluded_project||t.pgServiceId===FIXED_V3.core_excluded_postgres)return fail('target_is_core_prod');
 const c=e.connection;if(!c||c.role!==EXECUTOR_ROLE||typeof c.token!=='string'||!/^[0-9a-f]{64}$/.test(c.token))return fail('connection_identity_invalid');
 const pv=validateMeasuredExecutorPrivilegesV2(e.privileges);if(!pv.ok)return pv;
 const x=e.context;if(!x||typeof x!=='object'||Array.isArray(x))return fail('evidence_context_absent');
 const ckeys=['databaseCreate','databaseOwner','extendedFindings','observerIndependent','ownedCount','prohibitedReachable','schemaOwner','serverVersionMajor','unexpectedUsage'];
 if(Object.keys(x).sort().join(',')!==ckeys.join(','))return fail('evidence_context_shape_not_exact');
 if(x.observerIndependent!==true)return fail('observer_not_independent');
 if(![16,18].includes(x.serverVersionMajor))return fail('server_version_unsupported');
 for(const k of ['prohibitedReachable','unexpectedUsage','extendedFindings'])if(!Array.isArray(x[k])||x[k].length!==0)return fail('drift_'+k);
 if(x.schemaOwner!==false||x.databaseCreate!==false||x.databaseOwner!==false||x.ownedCount!==0)return fail('drift_owner_or_database_authority');
 const out=Object.freeze({target:Object.freeze({...t}),connection:Object.freeze({...c}),privileges:Object.freeze({...e.privileges,roleMemberships:Object.freeze([...e.privileges.roleMemberships]),schemaCreate:Object.freeze([...e.privileges.schemaCreate]),trustedSchemaUsage:Object.freeze([...e.privileges.trustedSchemaUsage]),executableRoutines:Object.freeze([...e.privileges.executableRoutines])}),observedAtMs:e.observedAtMs,dbNowMs:e.dbNowMs});
 evaluated.add(out);return {ok:true,evidence:out};
}
export function isEvaluatedExecutorEvidenceV2(e){return evaluated.has(e);}
