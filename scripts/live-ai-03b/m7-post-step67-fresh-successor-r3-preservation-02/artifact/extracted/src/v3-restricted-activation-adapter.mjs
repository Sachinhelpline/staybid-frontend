export const ACTIVATE_SQL_V3='SELECT live_ai_03b_trusted_v3.activate_catalog_v3($1::jsonb, $2)';
export const RESTORE_SQL_V3='SELECT live_ai_03b_trusted_v3.restore_catalog_v3_inactive($1::jsonb, $2)';
export function makeRestrictedActivationAdapterV3({dbClient}){
 if(!dbClient||typeof dbClient.query!=='function')throw new Error('db_client_absent');let activationClaimed=false,restoreClaimed=false;
 return Object.freeze({
  async activate({claims,executionId}){if(activationClaimed)return {ok:false,reason:'activation_is_one_shot'};activationClaimed=true;if(!claims||claims.contract!=='VerifiedApprovalClaimsV3'||claims.execution_id!==executionId)return {ok:false,reason:'claims_invalid'};try{const r=await dbClient.query(ACTIVATE_SQL_V3,[JSON.stringify(claims),executionId]);return {ok:true,result:r};}catch(e){return {ok:false,reason:'activation_db_error',uncertain:true,sqlstate:typeof e?.code==='string'?e.code:undefined};}},
  async restore({claims,executionId}){if(restoreClaimed)return {ok:false,reason:'restoration_is_one_shot'};restoreClaimed=true;if(!claims||claims.contract!=='VerifiedApprovalClaimsV3'||claims.execution_id!==executionId)return {ok:false,reason:'claims_invalid'};try{const r=await dbClient.query(RESTORE_SQL_V3,[JSON.stringify(claims),executionId]);return {ok:true,result:r};}catch(e){return {ok:false,reason:'restoration_db_error',uncertain:true,sqlstate:typeof e?.code==='string'?e.code:undefined};}}
 });
}
