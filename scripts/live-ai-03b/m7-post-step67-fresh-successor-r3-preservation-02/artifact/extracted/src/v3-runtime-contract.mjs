import * as G from './v3-digest-gen.mjs';
import { checkV3Catalog } from './v3-catalog-contract.mjs';
export const CONTRACT='LiveAi03bFreshSuccessorRuntimeV3';
export const PREACTIVATION_COUNTS=Object.freeze({catalogVersions:3,catalogEntries:8,activeCatalogVersions:0,activeCatalogEntries:0});
export const ACTIVATED_COUNTS=Object.freeze({catalogVersions:3,catalogEntries:8,activeCatalogVersions:1,activeCatalogEntries:3});
const fail=reason=>({ok:false,reason});
const canonical=x=>G.canonicalize(x);
function exactPredecessor(obs){
 const by=Object.fromEntries(obs.versions.map(v=>[v.id,v]));
 for(const p of [G.V1,G.V2]){const v=by[p.id];if(!v||v.status!=='inactive'||v.catalog_digest!==p.inactive_catalog_digest||v.effective_from!==p.t0||v.created_at!==p.t0||v.effective_until!==null)return false;}
 const expected=[...G.entryRows(G.V1.id,G.V1_RATES,G.V1.t0,G.V1.expiry,G.V1.source_digest,'inactive'),...G.entryRows(G.V2.id,G.V2_RATES,G.V2.t0,G.V2.expiry,G.V2.source_digest,'inactive')].sort((a,b)=>a.id.localeCompare(b.id));
 const actual=obs.entries.filter(e=>e.catalog_version_id===G.V1.id||e.catalog_version_id===G.V2.id).sort((a,b)=>a.id.localeCompare(b.id));
 return canonical(actual)===canonical(expected);
}
function dormant(obs){
 const p=obs.policyRows,c=obs.controlRows;if(!Array.isArray(p)||p.length!==1||!Array.isArray(c)||c.length!==2)return false;
 const x=p[0];if(x.id!==G.DORMANT.policy_id||x.project_id!=='live-ai-03b'||x.status!=='inactive'||x.policy_digest!==G.DORMANT.policy_digest||x.session_money_ceiling_micros!==0||x.session_provider_calls!==0||x.session_execution_admissions!==0||x.subject_day_money_ceiling_micros!==0||x.project_day_money_ceiling_micros!==0||x.project_month_money_ceiling_micros!==0||x.global_day_money_ceiling_micros!==0)return false;
 const cm=new Map(c.map(r=>[r.scope_type+':'+r.scope_key_digest,r]));const g=cm.get('global:global'),pr=cm.get('project:live-ai-03b');return !!g&&!!pr&&g.control_epoch===1&&g.enabled===false&&g.killed===false&&g.record_digest===G.DORMANT.control_global_digest&&pr.control_epoch===1&&pr.enabled===false&&pr.killed===false&&pr.record_digest===G.DORMANT.control_project_digest;
}
export function checkPreActivationState(obs,nowIso){if(!obs||!Array.isArray(obs.versions)||!Array.isArray(obs.entries))return fail('observation_absent');if(obs.versions.length!==3||obs.entries.length!==8)return fail('catalog_counts');if(!exactPredecessor(obs))return fail('predecessor_not_byte_exact');if(!dormant(obs))return fail('dormant_policy_controls_mismatch');const v3=obs.versions.find(v=>v.id===G.V3_ID),e3=obs.entries.filter(e=>e.catalog_version_id===G.V3_ID);const c=checkV3Catalog(v3,e3,'inactive',nowIso);if(!c.ok)return fail('v3_'+c.reason);if(obs.versions.some(v=>v.status!=='inactive')||obs.entries.some(e=>e.status!=='inactive'))return fail('unexpected_active_catalog');return {ok:true};}
export function checkActivatedState(obs,nowIso){if(!obs||!Array.isArray(obs.versions)||!Array.isArray(obs.entries))return fail('observation_absent');if(obs.versions.length!==3||obs.entries.length!==8)return fail('catalog_counts');if(!exactPredecessor(obs))return fail('predecessor_not_byte_exact');if(!dormant(obs))return fail('dormant_policy_controls_mismatch');const v3=obs.versions.find(v=>v.id===G.V3_ID),e3=obs.entries.filter(e=>e.catalog_version_id===G.V3_ID);const c=checkV3Catalog(v3,e3,'active',nowIso);if(!c.ok)return fail('v3_'+c.reason);if(obs.versions.filter(v=>v.status==='active').length!==1||obs.entries.filter(e=>e.status==='active').length!==3)return fail('sole_active_v3_required');return {ok:true};}
