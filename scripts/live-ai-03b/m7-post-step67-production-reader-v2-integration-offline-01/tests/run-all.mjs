import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const HERE=dirname(fileURLToPath(import.meta.url));
const ROOT=dirname(HERE);
const SRC=(n)=>join(ROOT,'src',n);
let pass=0, fail=0;
const rows=[];
function ok(name, cond, detail='') { if(cond){pass++; rows.push({name,status:'PASS'});} else {fail++; rows.push({name,status:'FAIL',detail:String(detail)});} }
function synth(id,obj){const keys=Object.keys(obj);return new vm.SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,obj[k]);},{identifier:id});}
async function load(file,stubs){
  const mod=new vm.SourceTextModule(readFileSync(file,'utf8'),{identifier:pathToFileURL(file).href,initializeImportMeta(meta,m){meta.url=m.identifier;}});
  await mod.link(async(spec)=>{if(!(spec in stubs)) throw new Error(`missing stub ${spec}`); return synth(spec,stubs[spec]);});
  await mod.evaluate(); return mod.namespace;
}
const FP='a'.repeat(64), FP2='b'.repeat(64), ANCHOR_FP='c'.repeat(64);
const RUNTIME_NAMES={executorDbUrl:'EX_DB',readerDbUrl:'RD_DB'};
const READER_ENV_NAMES={attesterIssuer:'RD_ISS',attesterPublicKeyDerB64:'RD_PUB',attesterFingerprint:'RD_FP',attesterHost:'RD_HOST',attesterPort:'RD_PORT',attesterChannelSecret:'RD_SECRET'};
const EX_NAMES={issuer:'LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER',publicKeyDerB64:'LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64',fingerprint:'LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT',host:'LIVE_AI_03B_EXECUTOR_ATTESTER_HOST',port:'LIVE_AI_03B_EXECUTOR_ATTESTER_PORT',channelSecret:'LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET'};
function baseEnv(){return {
  EX_DB:'postgres://executor',RD_DB:'postgres://reader',
  [EX_NAMES.issuer]:'executor-issuer',[EX_NAMES.publicKeyDerB64]:'ZXhlYw==',[EX_NAMES.fingerprint]:FP,[EX_NAMES.host]:'executor.railway.internal',[EX_NAMES.port]:'43173',[EX_NAMES.channelSecret]:'E'.repeat(40),
  [READER_ENV_NAMES.attesterIssuer]:'reader-issuer',[READER_ENV_NAMES.attesterPublicKeyDerB64]:'cmVhZGVy',[READER_ENV_NAMES.attesterFingerprint]:FP2,[READER_ENV_NAMES.attesterHost]:'reader.railway.internal',[READER_ENV_NAMES.attesterPort]:'8563',[READER_ENV_NAMES.attesterChannelSecret]:'R'.repeat(40),
  LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON:JSON.stringify({projectId:'P',environmentId:'E',pgServiceId:'PG',clusterFingerprint:ANCHOR_FP})
};}
function cfgStubs(){return {
  'node:crypto':{createHash},
  '../../m7-step2-runtime-rebinding-offline-01/runtime/v2-runtime-config.mjs':{
    REQUIRED_ENV_NAMES_V2:RUNTIME_NAMES,FORBIDDEN_ENV_NAMES_V2:[],
    loadRuntimeConfigV2:(env)=> env.CORE_TARGET ? {ok:false,reason:'config_targets_core_prod'} : {ok:true,targets:{projectId:'P',environmentId:'E',pgServiceId:'PG',gatewayServiceId:'GW'},reviewer:{pinnedPublicKeyDerB64:'reviewer',pinnedFingerprint:FP},secretRefs:{connectionIdentityProofRef:'executor-issuer'}}
  },
  '../../private-reader-production-integration-offline-01/reader-attestation.mjs':{makeAttesterTrustRoot:({issuer,publicKeyDerB64,fingerprint},{allowTestIssuer})=>({ok:true,trustRoot:{issuer,publicKeyDerB64,fingerprint,test:!!allowTestIssuer}})},
  '../../private-reader-production-integration-offline-01/attestation-source-channel.mjs':{validateAttesterChannelConfig:({host,port,channelSecret})=>({ok:typeof host==='string'&&Number.isInteger(port)&&typeof channelSecret==='string',reason:'channel_invalid'})},
  '../../private-reader-production-integration-offline-01/integration-config.mjs':{ENV:READER_ENV_NAMES},
  '../../private-reader-bootstrap-clock-peer-offline-01/production-config.mjs':{READER_ENV:{anchorJson:'LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON'}},
  '../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs':{RAILWAY_INTERNAL_RE:/^[a-z0-9-]+\.railway\.internal$/},
  '../../private-reader-attester-offline-01/target-binding.mjs':{parseDeploymentAnchor:(s)=>{try{const anchor=JSON.parse(s);return anchor&&anchor.clusterFingerprint?{ok:true,anchor}:{ok:false,reason:'anchor_malformed'};}catch{return {ok:false,reason:'anchor_malformed'};}}}
};}
const cfgNS=await load(SRC('provisioning-config.mjs'),cfgStubs());

// 1-8 Config matrix
{const e=baseEnv(); delete e.LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON; ok('01 anchor absent refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_v2_anchor_absent');}
{const e=baseEnv(); e.LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON='{'; ok('02 malformed anchor refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_v2_anchor_malformed');}
{const e=baseEnv(); e.LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON=JSON.stringify({projectId:'X',environmentId:'E',pgServiceId:'PG',clusterFingerprint:ANCHOR_FP}); ok('03 anchor project mismatch refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_v2_anchor_target_mismatch');}
{const e=baseEnv(); e.LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON=JSON.stringify({projectId:'P',environmentId:'X',pgServiceId:'PG',clusterFingerprint:ANCHOR_FP}); ok('04 anchor environment mismatch refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_v2_anchor_target_mismatch');}
{const e=baseEnv(); e.LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON=JSON.stringify({projectId:'P',environmentId:'E',pgServiceId:'X',clusterFingerprint:ANCHOR_FP}); ok('05 anchor Postgres mismatch refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_v2_anchor_target_mismatch');}
{const e=baseEnv(); e.CORE_TARGET='1'; ok('06 CORE target refused',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).ok!==true);}
{const e=baseEnv(); e[READER_ENV_NAMES.attesterHost]='203.0.113.10'; ok('07 production reader host must be Railway-private service',cfgNS.loadProvisioningConfig(e,{testBoundary:false}).reason==='reader_attester_host_not_railway_internal');}
{const e=baseEnv(); e[READER_ENV_NAMES.attesterHost]='127.0.0.1'; const a=cfgNS.loadProvisioningConfig(e,{testBoundary:false}), b=cfgNS.loadProvisioningConfig(e,{testBoundary:true}); ok('08 loopback is test-only',a.ok!==true && b.ok===true,JSON.stringify({a,b}));}

function pcFixture(){return {ok:true,version:'v2-production-authority-provisioning-config-v2-reader-clock',cfg:{ok:true,reviewer:{pinnedFingerprint:FP,pinnedPublicKeyDerB64:'reviewer'}},executorDbUrlEnvName:'EX_DB',readerDbUrlEnvName:'RD_DB',executorStatementTimeoutMs:10000,readerStatementTimeoutMs:2000,executorAttester:{trustRoot:{issuer:'executor-issuer',publicKeyDerB64:'ex',fingerprint:FP},channel:{host:'executor.railway.internal',port:43173,channelSecretEnvName:EX_NAMES.channelSecret}},readerAttester:{trustRoot:{issuer:'reader-issuer',publicKeyDerB64:'rd',fingerprint:FP2},channel:{host:'reader.railway.internal',port:8563,channelSecretEnvName:READER_ENV_NAMES.attesterChannelSecret}},anchorClusterFingerprint:ANCHOR_FP};}
function epStubs(acquireFn){return {
  'node:process':{default:process},'node:url':{fileURLToPath},
  '../../m7-step2-runtime-rebinding-offline-01/runtime/v2-trusted-executor-runtime.mjs':{composeTrustedExecutorProductionV2:()=>({available:false,reason:'unused'}),composeTrustedExecutorTestV2:()=>({available:false,reason:'unused'})},
  '../../private-reader-production-integration-offline-01/reader-session.mjs':{makePgPhysicalFactory:()=>({})},
  '../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs':{createExecutorAttestationSourceChannel:()=>({ok:true,source:{obtain(){}}})},
  '../../m7-step67-authority-dedicated-reader-attester-offline-01/src/reader-v2-attestation-source.mjs':{acquireReaderV2Attestation:acquireFn},
  './provisioning-config.mjs':{loadProvisioningConfig:()=>pcFixture(),PROVISIONING_CONFIG_VERSION:'v2-production-authority-provisioning-config-v2-reader-clock',EXECUTOR_ATTESTER_ENV:EX_NAMES,READER_ATTESTER_ENV:{...READER_ENV_NAMES,issuer:READER_ENV_NAMES.attesterIssuer,publicKeyDerB64:READER_ENV_NAMES.attesterPublicKeyDerB64,fingerprint:READER_ENV_NAMES.attesterFingerprint,host:READER_ENV_NAMES.attesterHost,port:READER_ENV_NAMES.attesterPort,channelSecret:READER_ENV_NAMES.attesterChannelSecret}},
  './reviewer-trust-root.mjs':{loadReviewerTrustRootV2:()=>({ok:false})},'./activation-source.mjs':{productionActivationSourceProofV2:()=>({ok:false})},'./executor-session.mjs':{makeExecutorPgPhysicalFactory:()=>({})},'./trusted-clock.mjs':{makeProductionClock:()=>({})},'./provisioner.mjs':{createAuthorityProvisionerV2:()=>({ok:false})}
};}
function providerTrusted(){const env=baseEnv(); env[READER_ENV_NAMES.attesterHost]='reader.railway.internal';env[READER_ENV_NAMES.attesterPort]='8563';return {env,provisioningConfig:pcFixture()};}
const GOOD_NONCE='1'.repeat(32), GOOD_ENV={signed:'reader'};
async function epNSWith(fn){return load(SRC('production-entrypoint.mjs'),epStubs(fn));}

// 9-20 Provider matrix
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); ok('09 provider construction exact key set',ns.acquireReaderAttestationProviderV2({...providerTrusted(),extra:1}).reason==='reader_v2_provider_inputs_invalid');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const t=providerTrusted();t.provisioningConfig.readerAttester.channel.host='other.railway.internal';ok('10 provider host mismatch refused',ns.acquireReaderAttestationProviderV2(t).reason==='reader_v2_provider_destination_mismatch');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const t=providerTrusted();t.provisioningConfig.readerAttester.channel.port=9999;ok('11 provider port mismatch refused',ns.acquireReaderAttestationProviderV2(t).reason==='reader_v2_provider_destination_mismatch');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const t=providerTrusted();t.provisioningConfig.readerAttester.channel.channelSecretEnvName='WRONG';ok('12 provider secret env name mismatch refused',ns.acquireReaderAttestationProviderV2(t).reason==='reader_v2_provider_config_invalid');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const t=providerTrusted();delete t.env[READER_ENV_NAMES.attesterChannelSecret];ok('13 provider absent secret refused',ns.acquireReaderAttestationProviderV2(t).reason==='reader_v2_provider_channel_secret_absent');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const t=providerTrusted();t.provisioningConfig.anchorClusterFingerprint='bad';ok('14 provider invalid anchor refused',ns.acquireReaderAttestationProviderV2(t).reason==='reader_v2_provider_anchor_invalid');}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'})); const p=ns.acquireReaderAttestationProviderV2(providerTrusted()).provider; const r=await p.obtain({session:{physical:{},token:'r'}}, {extra:1});ok('15 provider obtain accepts exactly one session object',r.reason==='reader_v2_provider_session_invalid');}
{const source=readFileSync(SRC('production-entrypoint.mjs'),'utf8');ok('16 production external v2 seam injection impossible',!/seams|acquireReaderV2Fn/.test(source));}
{const ns=await epNSWith(async()=>({ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v1'})); const r=await ns.acquireReaderAttestationProviderV2(providerTrusted()).provider.obtain({session:{physical:{},token:'r'}});ok('17 v1 protocol result refused',r.reason==='reader_v2_protocol_mismatch');}
{const ns=await epNSWith(async()=>({ok:true,envelope:null,requestNonce:'x',protocol:'reader-attestation-channel-v2'})); const r=await ns.acquireReaderAttestationProviderV2(providerTrusted()).provider.obtain({session:{physical:{},token:'r'}});ok('18 missing envelope/nonce refused',r.reason==='reader_v2_result_invalid');}
{const ns=await epNSWith(async()=>{throw new Error('secret detail')}); const r=await ns.acquireReaderAttestationProviderV2(providerTrusted()).provider.obtain({session:{physical:{},token:'r'}});ok('19 v2 acquisition exception is bounded',r.reason==='reader_v2_acquisition_failed');}
{let captured=null;const ns=await epNSWith(async(a)=>{captured=a;return {ok:true,envelope:GOOD_ENV,requestNonce:GOOD_NONCE,protocol:'reader-attestation-channel-v2'};});const t=providerTrusted(),p=ns.acquireReaderAttestationProviderV2(t).provider;const r=await p.obtain({session:{physical:{},token:'r'}});ok('20 provider never returns/logs channel secret',r.ok===true&&!JSON.stringify(r).includes(t.env[READER_ENV_NAMES.attesterChannelSecret])&&captured.channelSecret===t.env[READER_ENV_NAMES.attesterChannelSecret]);}

function makeProvisionerHarness(opts={}){
 const spy={exOpens:0,rdOpens:0,providerCalls:0,exSourceCalls:0,bindRd:null,bindEx:null,distinctCalls:0,guardRd:null,guardEx:null};
 const exPhys={closed:false,async close(){this.closed=true;}}, rdPhys={closed:false,async close(){this.closed=true;}};
 const exSession={physical:exPhys,token:'ex-token',dbNowMs:1000,identity:{role:'live_ai_03b_executor',pid:11,applicationName:'ex-app'}};
 const rdSession={physical:rdPhys,token:'rd-token',identity:{role:'live_ai_03b_reader',pid:22,applicationName:'rd-app'},effectiveStatementTimeoutMs:2000};
 let bound=false; const clock={isBound:()=>bound,bindToDbClock:()=>{bound=true;return {ok:true};},nowMs:()=>1000,nowIso:()=>new Date(1000).toISOString()};
 const pc=pcFixture();
 const rdNonce=opts.rdNonce||GOOD_NONCE;
 const provider=opts.provider||{async obtain(arg){spy.providerCalls++;spy.providerArg=arg; if(opts.providerFail)return {ok:false,reason:'reader_v2_acquisition_failed'}; if(opts.providerThrow)throw Object.assign(new Error('x'),{code:'reader_down'}); return {ok:true,envelope:{reader:true},requestNonce:rdNonce,protocol:opts.protocol||'reader-attestation-channel-v2'};}};
 const exSource={async obtain(arg){spy.exSourceCalls++;spy.exSourceArg=arg;return {executor:true};}};
 const deps={provisioningConfig:pc,reviewerTrustRoot:{pinnedPublicKeyDerB64:'reviewer',pinnedFingerprint:FP},activationSourceProof:{ok:true},clock,
   executorPhysicalFactory:{async open(){spy.exOpens++;return exPhys;}},readerPhysicalFactory:{async open(){spy.rdOpens++;return rdPhys;}},executorAttestationSource:exSource,readerAttestationProvider:provider};
 const stubs={
  'node:crypto':{randomBytes},
  '../../m7-step2-runtime-rebinding-offline-01/runtime/v2-production-authority.mjs':{PROVISIONER_CONTRACT_V2:'LiveAi03bProductionAuthorityProvisionerV2',REQUIRED_AUTHORITY_FIELDS_V2:['cfg','trustRoot','executorDbClient','readerDbClient','connectionIdentityProof','expectedIssuer','connectionToken','privilegeProof','registry','activationSourceProof','nowProvider'],validateProvisionedAuthorityV2:()=>({ok:true})},
  '../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs':{buildV2RegistrySupply:()=>({digest:'registry'}),assertSuppliedRegistryV2:()=>({ok:true})},
  '../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs':{checkActivationSourceProofV2:()=>({ok:true})},
  '../../private-reader-production-integration-offline-01/reader-session.mjs':{establishReaderSession:async(phys)=>({ok:true,session:{...rdSession,physical:phys}})},
  './executor-session.mjs':{EXECUTOR_ROLE:'live_ai_03b_executor',establishExecutorSession:async(phys)=>({ok:true,session:{...exSession,physical:phys}})},
  './role-binding.mjs':{EXECUTOR_ATTESTATION_CONTRACT:'AiStagingExecutorAttestationV1',bindExecutorConnection:(a)=>{spy.bindEx=a;return {ok:true,binding:{role:'live_ai_03b_executor',token:a.session.token,pid:11,applicationName:'ex-app',nonce:a.requestNonce,identityProof:{boundConnectionToken:a.session.token},expectedIssuer:'executor-issuer'}};},bindReaderConnection:(a)=>{spy.bindRd=a;return {ok:true,binding:{role:'live_ai_03b_reader',token:a.session.token,pid:22,applicationName:'rd-app',nonce:a.requestNonce,identityProof:{boundConnectionToken:a.session.token},expectedIssuer:'reader-issuer'}};},checkDistinctBindings:(a,b)=>{spy.distinctCalls++; if(opts.distinctFail)return {ok:false,reason:'distinct_failed'}; return {ok:a.nonce!==b.nonce,reason:'nonce_collision'};}},
  './guarded-clients.mjs':{makeGuardedExecutorClient:(s)=>{spy.guardEx=s;return {kind:'ex',session:s};},makeGuardedReaderClient:(s)=>{spy.guardRd=s;return {kind:'rd',session:s};}},
  './trusted-clock.mjs':{validateClock:()=>({ok:true})}
 };
 return {spy,deps,stubs,exPhys,rdPhys,rdSession};
}
async function runProv(opts={}){const h=makeProvisionerHarness(opts);const ns=await load(SRC('provisioner.mjs'),h.stubs);const p=ns.createAuthorityProvisionerV2(h.deps,{testBoundary:true});const r=p.ok?await p.provisioner.acquire():p;return {...h,ns,p,r};}

// 21-32 Provisioner matrix
{const h=await runProv();ok('21 exactly one reader physical open',h.r.available===true&&h.spy.rdOpens===1);}
{const h=await runProv();ok('22 exact rdS.session reaches provider',h.spy.providerArg.session===h.spy.guardRd&&h.spy.providerArg.session.physical===h.rdPhys);}
{const h=await runProv();ok('23 provider called exactly once',h.spy.providerCalls===1);}
{const h=await runProv();const src=readFileSync(SRC('provisioner.mjs'),'utf8');ok('24 provisioner does not generate reader nonce locally',h.spy.bindRd.requestNonce===GOOD_NONCE&&!/rdNonce\s*=\s*nonce\(/.test(src));}
{const h=await runProv({rdNonce:'2'.repeat(32)});ok('25 provider v2 nonce passed unchanged to final binding',h.spy.bindRd.requestNonce==='2'.repeat(32));}
{const h=await runProv({providerFail:true});ok('26 reader attestation failure closes both physicals',h.r.available===false&&h.exPhys.closed&&h.rdPhys.closed);}
{const h=await runProv({providerFail:true});ok('27 reader failure has no retry/reconnect',h.spy.providerCalls===1&&h.spy.exOpens===1&&h.spy.rdOpens===1);}
{const h=await runProv();ok('28 executor attestation path unchanged in shape',h.spy.exSourceCalls===1&&h.spy.exSourceArg.contract==='AiStagingExecutorAttestationV1'&&h.spy.exSourceArg.connectionToken==='ex-token'&&h.spy.exSourceArg.role==='live_ai_03b_executor'&&/^[0-9a-f]{32}$/.test(h.spy.exSourceArg.requestNonce));}
{const h=await runProv({distinctFail:true});ok('29 pairwise distinctness remains fail-closed',h.r.reason==='distinct_failed'&&h.spy.distinctCalls===1);}
{const h=await runProv();ok('30 guarded reader uses same verified reader session',h.spy.guardRd===h.spy.bindRd.session&&h.spy.guardRd===h.spy.providerArg.session);}
{const h=await runProv();const keys=Object.keys(h.r.authority).sort().join(',');ok('31 frozen authority exact field set preserved',h.r.available===true&&keys==='activationSourceProof,cfg,connectionIdentityProof,connectionToken,executorDbClient,expectedIssuer,nowProvider,privilegeProof,readerDbClient,registry,trustRoot');}
{const h=makeProvisionerHarness();const ns=await load(SRC('provisioner.mjs'),h.stubs);const p=ns.createAuthorityProvisionerV2(h.deps,{testBoundary:true});const a=await p.provisioner.acquire(),b=await p.provisioner.acquire();ok('32 provisioner one-shot semantics unchanged',a.available===true&&b.reason==='provisioner_acquire_is_one_shot'&&h.spy.exOpens===1&&h.spy.rdOpens===1);}

// 33-41 Static/preservation matrix
const epSrc=readFileSync(SRC('production-entrypoint.mjs'),'utf8'), provSrc=readFileSync(SRC('provisioner.mjs'),'utf8'), cfgSrc=readFileSync(SRC('provisioning-config.mjs'),'utf8');
const frozen=JSON.parse(readFileSync(join(ROOT,'identity','FROZEN-BASELINE.json'),'utf8'));
const closure=JSON.parse(readFileSync(join(ROOT,'identity','IMPORT-CLOSURE.json'),'utf8'));
const sourceId=JSON.parse(readFileSync(join(ROOT,'identity','CANDIDATE-SOURCE-IDENTITY.json'),'utf8'));
ok('33 production entrypoint has no reader createAttestationSourceChannel use',!epSrc.includes('createAttestationSourceChannel'));
ok('34 no reader v1 fallback path exists',!epSrc.includes('reader-attestation-channel-v1')&&!provSrc.includes('readerAttestationSource'));
ok('35 role-binding frozen blob recorded unchanged',frozen.files['scripts/live-ai-03b/m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs']==='c154a884e58ab1d1609c74eb4148754c30bc14a7');
ok('36 frozen Step-2 runtime blobs recorded unchanged',Object.entries(frozen.files).filter(([p])=>p.includes('/m7-step2-runtime-rebinding-offline-01/runtime/')).length===4&&Object.entries(frozen.files).filter(([p])=>p.includes('/m7-step2-runtime-rebinding-offline-01/runtime/')).every(([,sha])=>/^[0-9a-f]{40}$/.test(sha)));
ok('37 frozen v2 acquisition blob exact',frozen.files['scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/src/reader-v2-attestation-source.mjs']==='1a6853596c52553f5c734539e59110307659a5c9');
ok('38 accepted v2 import closure recorded',Object.keys(closure.directAcceptedBootstrapDependencies).length===5&&Object.values(closure.directAcceptedBootstrapDependencies).every(x=>/^[0-9a-f]{40}$/.test(x)));
ok('39 no Gateway/provider/CORE operational import added',[cfgSrc,epSrc,provSrc].every(s=>!/^import .*?(gateway|provider).*$/im.test(s)&&!s.includes('OPENAI_API_KEY')));
ok('40 no secret logging or env dump',[cfgSrc,epSrc,provSrc].every(s=>!/(console\.(log|info|warn|error)|printenv|JSON\.stringify\(\s*(process\.)?env)/.test(s)));
{let good=true;for(const [rel,m] of Object.entries(sourceId.files)){const b=readFileSync(join(ROOT,rel));good&&=b.length===m.bytes&&createHash('sha256').update(b).digest('hex')===m.sha256;}ok('41 candidate source identity matches bytes',good);}

// 42-45 Positive integration / isolation
{const h=await runProv();ok('42 positive offline provisioner reaches frozen authority shape',h.r.available===true&&h.r.authority&&h.r.authority.readerDbClient.kind==='rd');}
{const h=await runProv();ok('43 reader proof protocol observed v2',h.r.available===true&&h.spy.bindRd.requestNonce===GOOD_NONCE);}
{const h=await runProv();ok('44 same-reader-session identity proven end to end',h.spy.providerArg.session===h.spy.bindRd.session&&h.spy.bindRd.session===h.spy.guardRd&&h.spy.bindRd.session.physical===h.rdPhys);}
{const all=cfgSrc+'\n'+epSrc+'\n'+provSrc;ok('45 offline candidate has zero live Railway/DB/network execution hooks',!/(railway\s|psql\s|fetch\(|https?:\/\/|child_process|execSync|spawnSync)/.test(all));}

const result={schema:'m7-post-step67-reader-v2-offline-test-result-v1',total:pass+fail,pass,fail,rows};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(fail) process.exitCode=1;
