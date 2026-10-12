import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePlanning } from '../src/planning-ai.js';
const req = body => new Request('https://example.org/api/planning', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
function fixture() {
  let calls=0, reservations=0;
  const env={ AI_ENABLED:'true', CF_ACCOUNT_ID:'a'.repeat(32), CF_BILLING_READ_TOKEN:'test', AI:{run:async()=>{calls++;return {response:'{"questions":["Do you need delivery or shared equipment?"]}'};}},AI_BUDGET:{idFromName:n=>n,get:()=>({fetch:async()=>{reservations++;return Response.json({allowed:true});}})}};
  return {env, counts:()=>[calls,reservations]};
}
const free=async()=>Response.json({success:true,result:[]});
test('free verified planning generates questions with one shared reservation',async()=>{
  const {env,counts}=fixture();const result=await (await handlePlanning(req({description:'A student cultural dinner'}),env,free)).json();assert.equal(result.mode,'ai');assert.deepEqual(counts(),[1,1]);
});
test('disabled, unverified and paid accounts never invoke AI',async()=>{
  for (const mode of ['disabled','missing','paid']) {const {env,counts}=fixture();if(mode==='disabled')env.AI_ENABLED='false';if(mode==='missing')delete env.CF_BILLING_READ_TOKEN;
    const result=await(await handlePlanning(req({description:'Dinner'}),env,mode==='paid'?async()=>Response.json({success:true,result:[{price:5,rate_plan:{id:'workers_paid'}}]}):free)).json();assert.equal(result.mode,'rules');assert.deepEqual(counts(),[0,0]);}
});
test('limits stop inference and invalid output never exposes prices or markup',async()=>{
  const {env,counts}=fixture();env.AI_BUDGET.get=()=>({fetch:async()=>Response.json({allowed:false})});assert.equal((await(await handlePlanning(req({description:'Dinner'}),env,free)).json()).reason,'daily_limit');assert.equal(counts()[0],0);
  for(const response of ['{"questions":["Spend $500?"]}','{"questions":["<img src=x>?"]}','not JSON','{"questions":["You are approved?"]}']){const {env}=fixture();env.AI.run=async()=>({response});assert.equal((await(await handlePlanning(req({description:'Dinner'}),env,free)).json()).mode,'rules');}
});
test('oversized and forged client context are rejected before provider calls',async()=>{
  const {env,counts}=fixture();for(const body of [{description:'a'.repeat(601)},{description:'Dinner',amount:500},{description:''}])assert.equal((await handlePlanning(req(body),env,free)).status,400);
  assert.equal((await handlePlanning(new Request('https://example.org/api/planning'),env,free)).status,405);
  assert.deepEqual(counts(),[0,0]);
});
