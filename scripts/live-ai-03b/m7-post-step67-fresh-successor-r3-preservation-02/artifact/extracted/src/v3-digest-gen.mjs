import { createHash } from 'node:crypto';

export const T0 = '2026-10-06T22:44:42Z';
export const T0_PLUS_7_DAYS = '2026-10-13T22:44:42Z';
export const CATALOG_DOMAIN = 'staybid.live-ai.budget.price-catalog.v1';
export const POLICY_DOMAIN = 'staybid.live-ai.budget.policy.v1';
export const CONTROL_DOMAIN = 'staybid.live-ai.budget.control.v1';
export const BUNDLE_DOMAIN_V3 = 'staybid.live-ai.activation-bundle.v3';
export const SOURCE_ID = 'openai-api-pricing/gpt-5.6-terra/standard/short-context/v1';
export const SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
export const PROJECT_ID = 'live-ai-03b';
export const V3_ID = 'openai-gpt-5-6-terra-standard-short-v3';
export const V3_CEILING_MICROS = 105920;
export const ONECALL_POLICY_ID = 'live-ai-03b-policy-oneprobe-v2';
export const ONECALL_POLICY_ACTIVE_DIGEST = '864e24817b2f98d741495bb403c20ada31cd4f27db3d9dfe1c50bb7d99ad9245';
export const BASE_COMMIT = '9270c282d5fd65e9fe49261391badfe92c777b8f';
export const BASE_TREE = 'c46da04123dc44cd9954fe350de0b1bc20ff0948';
export const SUCCESSOR_PARENT_COMMIT = '37349fe9b33bb1045d0c7b062d4b5c4d7c330c1d';

export const V1 = Object.freeze({
  id:'openai-gpt-5-6-terra-standard-short-v1', t0:'2026-09-18T18:37:35Z', expiry:'2026-09-25T18:37:35Z',
  source_digest:'fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3',
  inactive_catalog_digest:'453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973',
  active_catalog_digest:'616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8'
});
export const V2 = Object.freeze({
  id:'openai-gpt-5-6-terra-standard-short-v2', t0:'2026-09-28T15:26:23Z', expiry:'2026-10-05T15:26:23Z',
  source_digest:'ec23657bf0c20390afec4d4f233f14300e43b136cc6f27c25d6ffc35e1d7b357',
  inactive_catalog_digest:'36355fab5be8009fa66352ce678394d4963f2927a39d1a8eea63f4aa5b939b62',
  active_catalog_digest:'836548ef0274f3a068c83cf4d8e952eb6388921f2064c5e29e8ec25cd7eb798b'
});
export const DORMANT = Object.freeze({
 t0:'2026-09-18T14:11:25Z', policy_id:'live-ai-03b-policy-v1-dormant',
 policy_digest:'cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4',
 control_global_digest:'26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee',
 control_project_digest:'be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f'
});
export const CONTROL_DIGESTS = Object.freeze({
 global_activation:'0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b',
 project_activation:'eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f'
});

export function canonicalize(v){
 if(v===null)return 'null'; const t=typeof v;
 if(t==='boolean')return v?'true':'false';
 if(t==='number'){if(!Number.isInteger(v))throw new Error('floating-point forbidden'); return String(v);}
 if(t==='string')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonicalize).join(',')+']';
 if(t==='object'){const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+canonicalize(v[k])).join(',')+'}';}
 throw new Error('unsupported type '+t);
}
export function sha256hex(s){return createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');}
export function digestOf(v){const canonical=canonicalize(v);return {canonical,digest:sha256hex(canonical)};}

export const V3_RATES = Object.freeze([
 Object.freeze({suffix:'-reasoning-input-token-base',billing_dimension:'reasoning_input_token',service_tier:null,unit_size:1000000,rate_micros:2000000}),
 Object.freeze({suffix:'-reasoning-input-token-cache-write',billing_dimension:'reasoning_input_token',service_tier:'cache_write',unit_size:1000000,rate_micros:2500000}),
 Object.freeze({suffix:'-reasoning-output-token-base',billing_dimension:'reasoning_output_token',service_tier:null,unit_size:1000000,rate_micros:12000000})
]);
export const V2_RATES=V3_RATES;
export const V1_RATES=Object.freeze([V3_RATES[0],V3_RATES[2]]);
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
export function sourcePayload(rates,verifiedAt,versionId){
 const ordered=rates.map(r=>({id:versionId+r.suffix,r})).sort(byId).map(x=>x.r);
 return {context_tier:'short',currency:'USD',model:'gpt-5.6-terra',processing_mode:'standard',provider:'openai',
   rates:ordered.map(r=>({billing_dimension:r.billing_dimension,rate_micros:r.rate_micros,service_tier:r.service_tier,unit_size:r.unit_size})),
   source_id:SOURCE_ID,source_url:SOURCE_URL,verified_at:verifiedAt};
}
export function entryRows(versionId,rates,t0,expiry,sourceDigest,status){return rates.map(r=>({
 id:versionId+r.suffix,catalog_version_id:versionId,provider:'openai',model:'gpt-5.6-terra',service_tier:r.service_tier,
 billing_dimension:r.billing_dimension,currency_code:'USD',unit_size:r.unit_size,rate_micros:r.rate_micros,effective_from:t0,effective_until:null,
 verified_at:t0,verification_expires_at:expiry,source_id:SOURCE_ID,source_digest:sourceDigest,status,created_at:t0
})).sort(byId);}
export function catalogPayload(versionId,rates,t0,expiry,sourceDigest,status){return {catalog_version:{id:versionId,status,effective_from:t0,effective_until:null,created_at:t0},domain:CATALOG_DOMAIN,entries:entryRows(versionId,rates,t0,expiry,sourceDigest,status)};}
export const MAX_INPUT_TOKENS=32768, MAX_OUTPUT_TOKENS=2000;
const ceilDiv=(a,b)=>a===0n?0n:(a+b-1n)/b;
export function worstCaseMicros(rates){let input=0n;for(const r of rates)if(r.billing_dimension==='reasoning_input_token'){const c=ceilDiv(BigInt(MAX_INPUT_TOKENS)*BigInt(r.rate_micros),BigInt(r.unit_size));if(c>input)input=c;}const out=rates.find(r=>r.billing_dimension==='reasoning_output_token'&&r.service_tier===null);return Number(input+ceilDiv(BigInt(MAX_OUTPUT_TOKENS)*BigInt(out.rate_micros),BigInt(out.unit_size)));}

const v1Source=digestOf(sourcePayload(V1_RATES,V1.t0,V1.id));
const v2SourceCheck=digestOf(sourcePayload(V2_RATES,V2.t0,V2.id));
export const PREDECESSOR_CHECKS=Object.freeze([
 ['v1_source',v1Source.digest,V1.source_digest],
 ['v1_inactive',digestOf(catalogPayload(V1.id,V1_RATES,V1.t0,V1.expiry,V1.source_digest,'inactive')).digest,V1.inactive_catalog_digest],
 ['v1_active',digestOf(catalogPayload(V1.id,V1_RATES,V1.t0,V1.expiry,V1.source_digest,'active')).digest,V1.active_catalog_digest],
 ['v2_source',v2SourceCheck.digest,V2.source_digest],
 ['v2_inactive',digestOf(catalogPayload(V2.id,V2_RATES,V2.t0,V2.expiry,V2.source_digest,'inactive')).digest,V2.inactive_catalog_digest],
 ['v2_active',digestOf(catalogPayload(V2.id,V2_RATES,V2.t0,V2.expiry,V2.source_digest,'active')).digest,V2.active_catalog_digest],
]);
export const PREDECESSOR_FAILURES=PREDECESSOR_CHECKS.filter(([,a,b])=>a!==b);
export const v3Source=digestOf(sourcePayload(V3_RATES,T0,V3_ID));
export const SOURCE_DIGEST_V3=v3Source.digest;
export const v3Inactive=digestOf(catalogPayload(V3_ID,V3_RATES,T0,T0_PLUS_7_DAYS,SOURCE_DIGEST_V3,'inactive'));
export const v3Active=digestOf(catalogPayload(V3_ID,V3_RATES,T0,T0_PLUS_7_DAYS,SOURCE_DIGEST_V3,'active'));
export const V3_ENTRY_IDS=Object.freeze(entryRows(V3_ID,V3_RATES,T0,T0_PLUS_7_DAYS,SOURCE_DIGEST_V3,'inactive').map(x=>x.id));
export const V3_WORST_CASE_MICROS=worstCaseMicros(V3_RATES);
export function bundlePayloadV3(){return {domain:BUNDLE_DOMAIN_V3,base_commit:BASE_COMMIT,base_tree:BASE_TREE,catalog_version_id:V3_ID,inactive_catalog_digest:v3Inactive.digest,active_catalog_digest:v3Active.digest,source_digest:SOURCE_DIGEST_V3,catalog_verification_expiry:T0_PLUS_7_DAYS,one_call_policy_id:ONECALL_POLICY_ID,one_call_policy_digest:ONECALL_POLICY_ACTIVE_DIGEST,one_call_money_ceiling_micros:V3_CEILING_MICROS,control_global_activation_digest:CONTROL_DIGESTS.global_activation,control_project_activation_digest:CONTROL_DIGESTS.project_activation,service_tier:'default',successor_parent_commit:SUCCESSOR_PARENT_COMMIT};}
export const v3Bundle=digestOf(bundlePayloadV3());
export const RESULT=Object.freeze({T0,T0_PLUS_7_DAYS,V3_ID,V3_ENTRY_IDS,SOURCE_DIGEST_V3,inactive_catalog_digest:v3Inactive.digest,active_catalog_digest:v3Active.digest,one_call_policy_id:ONECALL_POLICY_ID,one_call_policy_digest:ONECALL_POLICY_ACTIVE_DIGEST,worst_case_reservation_micros:V3_WORST_CASE_MICROS,activation_bundle_digest:v3Bundle.digest,predecessor_self_check_ok:PREDECESSOR_FAILURES.length===0});
if(import.meta.url===`file://${process.argv[1]}`){if(PREDECESSOR_FAILURES.length||V3_WORST_CASE_MICROS!==V3_CEILING_MICROS){console.error({PREDECESSOR_FAILURES,V3_WORST_CASE_MICROS});process.exit(2);}console.log(JSON.stringify(RESULT,null,2));}
