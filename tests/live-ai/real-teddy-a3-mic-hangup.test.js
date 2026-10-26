#!/usr/bin/env node
// A3 deterministic offline fake-provider regression; NO real network, no credentials.
"use strict";
const { strict: assert } = require("node:assert");
const path = require("node:path");
const cp = require("node:child_process");
const repo = path.resolve(__dirname,"..","..");
const tsc = require.resolve("typescript/bin/tsc",{paths:[repo]});
const built=cp.spawnSync(process.execPath,[tsc,"-p","server/voice-gateway/tsconfig.json"],{cwd:repo,encoding:"utf8"});
if (built.status!==0) throw new Error(`compile failed: ${built.stderr}\n${built.stdout}`);
const TX=require(path.join(repo,"server/voice-gateway/dist/openai-transcription.js"));
const G=require(path.join(repo,"server/voice-gateway/dist/index.js"));
let n=0;function pass(label){console.log("PASS",++n,label);}
const OFFER="v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n",ANSWER="v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n";
(async()=>{
  assert.equal(TX.parseRealtimeCallId("/v1/realtime/calls/rtc_Aa-09_"),"rtc_Aa-09_");pass("provider Location ID parsed only from exact path");
  for(const v of [null,"https://evil.test/v1/realtime/calls/rtc_x","/v1/realtime/calls/rtc_x/hangup","/v1/realtime/calls/rtc_x?evil=1","/v1/realtime/calls/other","/v1/realtime/calls/rtc_x%2Fetc"]){assert.equal(TX.parseRealtimeCallId(v),null);}pass("untrusted Location never supplies arbitrary URL");
  const seen=[];
  const fake=async(url,init)=>{seen.push({url,method:init.method});if(url.endsWith("/hangup"))return {ok:true,text:async()=>""};return {ok:true,headers:{get:(k)=>k==="location"?"/v1/realtime/calls/rtc_Owner111":null},text:async()=>ANSWER};};
  const seam=TX.createDefaultTranscriptionSeam("test-only-no-real-provider",fake);
  let neg=await seam.negotiate(OFFER);assert.equal(neg.ok,true);assert.equal(neg.providerCallId,"rtc_Owner111");pass("SDP returned with bound opaque provider call ID");
  const adapter=TX.createTranscriptionAdapter({model:TX.STT_MODEL,call:seam.call,negotiate:seam.negotiate,hangup:seam.hangup});
  const ctx=G.buildLiveAiContext({env:{},transcription:adapter});
  const created=ctx.store.create({sessionId:"user-owned",subject:"pub1.testing",authenticated:true,ipHash:"test-ip"});assert.equal(created.ok,true);const session=created.session;
  assert.equal(ctx.trackMicCall(session,neg.providerCallId),true);pass("server binds provider ID to authenticated active session");
  assert.equal(ctx.trackMicCall(session,"rtc_SECOND"),false);pass("duplicate cross-bind refused");
  ctx.stopMicCall(session);ctx.stopMicCall(session);await new Promise(r=>setImmediate(r));assert.equal(seen.filter(x=>x.url.endsWith("/hangup")).length,1);assert.equal(seen.at(-1).url,"https://api.openai.com/v1/realtime/calls/rtc_Owner111/hangup");pass("idempotent authenticated server-only hangup to fixed provider origin");
  ctx.store.terminate(session,"user");await new Promise(r=>setImmediate(r));assert.equal(seen.filter(x=>x.url.endsWith("/hangup")).length,1);pass("termination after interrupt does not duplicate hangup");
  const closed=ctx.store.create({sessionId:"too-late",subject:"pub1.testing2",authenticated:true,ipHash:"test-ip2"});assert.equal(closed.ok,true);ctx.store.terminate(closed.session,"closed");assert.equal(ctx.trackMicCall(closed.session,"rtc_LATE"),false);await new Promise(r=>setImmediate(r));assert.equal(seen.filter(x=>x.url.endsWith("/hangup")).length,2);pass("late negotiation after termination triggers immediate provider hangup");
  const anon=ctx.store.create({sessionId:"anonymous",subject:"anon.test",authenticated:false,ipHash:"test-ip3"});assert.equal(anon.ok,true);assert.equal(ctx.trackMicCall(anon.session,"rtc_FORBIDDEN"),false);ctx.store.terminate(anon.session,"closed");pass("anonymous session cannot bind provider call ID");
  const missing=TX.createDefaultTranscriptionSeam("test-only",async()=>({ok:true,headers:{get:()=>null},text:async()=>ANSWER}));assert.equal((await missing.negotiate(OFFER)).ok,false);pass("missing Location fails closed without exposing SDP");
  const malformed=TX.createDefaultTranscriptionSeam("test-only",async(url)=>url.endsWith("/hangup")?{ok:true,text:async()=>""}:{ok:true,headers:{get:()=>"/v1/realtime/calls/rtc_MALFORMED"},text:async()=>"not-SDP"});assert.equal((await malformed.negotiate(OFFER)).ok,false);pass("invalid SDP causes provider hangup");
  const fail=TX.createDefaultTranscriptionSeam("test-only",async(url)=>url.endsWith("/hangup")?{ok:false,text:async()=>""}:{ok:true,headers:{get:()=>"/v1/realtime/calls/rtc_FAIL"},text:async()=>ANSWER});assert.equal(await fail.hangup("rtc_FAIL"),false);pass("failed provider hangup not reported as success");
  assert.equal(await seam.hangup("rtc_X/evil"),false);pass("unsafe call ID blocked before any provider request");
  console.log(`A3_MIC_HANGUP ${n}/${n} PASS (provider network attempts ZERO; injected fake only)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
