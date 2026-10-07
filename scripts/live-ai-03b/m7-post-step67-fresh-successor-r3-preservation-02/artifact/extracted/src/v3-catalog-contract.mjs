import * as G from './v3-digest-gen.mjs';
const RFC=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const fail=(reason)=>({ok:false,reason});
const VERSION_KEYS=['catalog_digest','created_at','effective_from','effective_until','id','status'];
const ENTRY_KEYS=['billing_dimension','catalog_version_id','created_at','currency_code','effective_from','effective_until','id','model','provider','rate_micros','service_tier','source_digest','source_id','status','unit_size','verification_expires_at','verified_at'];
const same=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...ks].sort().join(',');
export function reviewedV3Rows(status='inactive'){
 return {version:{id:G.V3_ID,status,effective_from:G.T0,effective_until:null,catalog_digest:status==='active'?G.v3Active.digest:G.v3Inactive.digest,created_at:G.T0},entries:G.entryRows(G.V3_ID,G.V3_RATES,G.T0,G.T0_PLUS_7_DAYS,G.SOURCE_DIGEST_V3,status)};
}
export function checkV3Catalog(version,entries,expectStatus,nowIso){
 if(!same(version,VERSION_KEYS))return fail('version_row_shape');
 if(!Array.isArray(entries)||entries.length!==3)return fail('entry_count');
 if(version.id!==G.V3_ID||version.status!==expectStatus)return fail('version_identity_or_status');
 const ids=entries.map(x=>x?.id).sort(); if(new Set(ids).size!==3||ids.join(',')!==[...G.V3_ENTRY_IDS].sort().join(','))return fail('entry_id_mismatch');
 for(const e of entries){
  if(!same(e,ENTRY_KEYS))return fail('entry_row_shape');
  if(e.catalog_version_id!==G.V3_ID||e.provider!=='openai'||e.model!=='gpt-5.6-terra'||e.currency_code!=='USD'||e.unit_size!==1000000)return fail('entry_identity_mismatch');
  if(e.status!==expectStatus||e.source_id!==G.SOURCE_ID||e.source_digest!==G.SOURCE_DIGEST_V3)return fail('entry_source_or_status');
  if(e.verified_at!==G.T0||e.effective_from!==G.T0||e.created_at!==G.T0||e.verification_expires_at!==G.T0_PLUS_7_DAYS||e.effective_until!==null)return fail('entry_freshness');
 }
 const by=Object.fromEntries(entries.map(e=>[e.id,e])); const [IN,CW,OUT]=G.V3_ENTRY_IDS;
 const want={ [IN]:['reasoning_input_token',null,2000000],[CW]:['reasoning_input_token','cache_write',2500000],[OUT]:['reasoning_output_token',null,12000000] };
 for(const id of G.V3_ENTRY_IDS){const e=by[id],w=want[id];if(e.billing_dimension!==w[0]||e.service_tier!==w[1]||e.rate_micros!==w[2])return fail('rate_mismatch');}
 const rebuilt=G.digestOf({catalog_version:{id:version.id,status:version.status,effective_from:version.effective_from,effective_until:version.effective_until,created_at:version.created_at},domain:G.CATALOG_DOMAIN,entries:[...entries].sort((a,b)=>a.id.localeCompare(b.id))}).digest;
 const reviewed=expectStatus==='active'?G.v3Active.digest:G.v3Inactive.digest;
 if(rebuilt!==reviewed||version.catalog_digest!==reviewed)return fail('catalog_digest_mismatch');
 if(!RFC.test(String(nowIso)))return fail('now_malformed'); const now=Date.parse(nowIso); if(now<Date.parse(G.T0))return fail('verified_at_in_future'); if(now>=Date.parse(G.T0_PLUS_7_DAYS))return fail('verification_stale');
 if(G.worstCaseMicros(entries.map(e=>({billing_dimension:e.billing_dimension,service_tier:e.service_tier,rate_micros:e.rate_micros,unit_size:e.unit_size})))!==G.V3_CEILING_MICROS)return fail('worst_case_mismatch');
 return {ok:true,digest:rebuilt};
}
