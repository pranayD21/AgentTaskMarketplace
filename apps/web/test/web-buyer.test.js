import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createBuyerBridge } from '../server/buyer.mjs';

const spec={prompt:'Synthetic test instruction',context:'Fixture context',allowed_models:['qwen3:8b'],price_cents:100,
  expires_in_s:3600,max_tokens:512,rubric:{kind:'contains_text',expected_text:'fixture'}};
async function fixture(human = false) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atm-web-buyer-'));
  const endpoint='https://marketplace.invalid/mcp';
  const statePath=path.join(dir,'buyer.json'), budgetPath=path.join(dir,'budget.json'), policyPath=path.join(dir,'policy.json');
  fs.writeFileSync(statePath,JSON.stringify({marketplace_url:endpoint,agent_id:'buyer_fixture',api_key:'atm_sk_PRIVATE_TEST_KEY',owner:human?{user_id:'human_fixture'}:undefined}));
  fs.writeFileSync(budgetPath,JSON.stringify({schema:'atm-api-budget/v1',cap_microusd:5000000,entries:{baseline:{state:'settled',booked_microusd:2390}}}));
  fs.writeFileSync(policyPath,JSON.stringify({endpoint,judge_model:'claude-opus-5-5',max_attempts:3,submissions_enabled:true,valid_until:new Date(Date.now()+600000).toISOString()}));
  const posts=new Map(), calls=[];
  let disconnect=false, result;
  const task={task_id:'task_fixture',buyer_id:'buyer_fixture',status:'OPEN',price_cents:100,allowed_models:['qwen3:8b'],payment:{state:'HELD'}};
  const clientFactory=(_url,key)=>{
    expect(key).toBe('atm_sk_PRIVATE_TEST_KEY');
    return {initialize:async()=>{},tool:async(name,args)=>{
      calls.push(name);
      if(name==='whoami') return {agent_id:'buyer_fixture',kind:'buyer',display_name:'Fixture buyer',owner:human?{user_id:'human_fixture'}:undefined,buyer_payment:{buyer_payment_status:'READY'},provider_budget:{enforced:true,available:!disconnect},spend:{cap_cents:2000,spent_cents:150,reserved_cents:0,available_cents:1850}};
      if(name==='marketplace_info') return {pricing:{mode:'task_offer'},payments:{mode:'card',min_cents:50,max_cents:100000},models:[{model_id:'qwen3:8b'}]};
      if(name==='list_sellers') return {sellers:[{seller_id:'seller_fixture',display_name:'Fixture seller',status:'ACTIVE',models:[{model_id:'qwen3:8b'}],runner:{runtime:'wassette'},last_seen:new Date().toISOString()}]};
      if(name==='list_my_tasks') return {tasks:[task]};
      if(name==='post_task') {
        if(!human) expect(JSON.parse(fs.readFileSync(budgetPath)).entries[args.client_request_id].booked_microusd).toBe(2200000);
        if(!posts.has(args.client_request_id)) posts.set(args.client_request_id,{...task,task_id:`task_${posts.size+1}`});
        if(disconnect) {disconnect=false;throw new Error('PRIVATE_PROVIDER_BODY');}
        return {task:posts.get(args.client_request_id)};
      }
      if(name==='get_result') return result ?? {task,result:null,replacement_status:null,settlement:null};
      if(name==='cancel_task') {task.status='CANCELLED';return {task};}
      throw new Error('Unexpected tool');
    }};
  };
  const options={endpoint,statePath,budgetPath,policyPath,humanAccount:human,getSession:()=>({user_id:'human_fixture'}),journalDir:path.join(dir,'drafts'),clientFactory};
  let middleware=createBuyerBridge(options);
  const server=http.createServer((req,res)=>void middleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  let token;
  async function session() {token=(await (await fetch(`${url}/api/buyer`,{headers:{origin:url}})).json()).token;}
  await session();
  async function call(action,data={}) {
    const r=await fetch(`${url}/api/buyer`,{method:'POST',headers:{origin:url,'content-type':'application/json','x-atm-csrf':token},body:JSON.stringify({action,...data})});
    return {status:r.status,...await r.json()};
  }
  return {dir,url,call,calls,posts,budgetPath,policyPath,options,disconnect:()=>{disconnect=true;},setResult:v=>{result=v;},
    restart:async()=>{middleware=createBuyerBridge(options);await session();},
    close:async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

describe('human buyer bridge',()=>{
  it('uses the existing identity, rejects other origins and missing CSRF, and exposes no credential',async()=>{
    const f=await fixture();try {
      expect((await fetch(`${f.url}/api/buyer`,{headers:{origin:'https://evil.invalid'}})).status).toBe(400);
      expect((await fetch(`${f.url}/api/buyer`,{method:'POST',headers:{origin:f.url,'content-type':'application/json'},body:'{"action":"submit"}'})).status).toBe(400);
      expect(f.calls).toEqual([]);
      const state=await f.call('state');expect(state.status).toBe(200);expect(state.buyer.agent_id).toBe('buyer_fixture');
      expect(JSON.stringify(state)).not.toContain('PRIVATE_TEST_KEY');expect(f.calls).not.toContain('register_agent');
    } finally {await f.close();}
  });
  it('validates price, model, payload and rubric before any purchase',async()=>{
    const f=await fixture();try {
      for(const input of [{...spec,price_cents:2000},{...spec,price_cents:49},{...spec,allowed_models:['unknown']},
        {...spec,rubric:{kind:'llm_rubric',criteria:'quality'}}]) {
        expect((await f.call('prepare',{input})).status).toBe(400);
      }
      expect(f.posts.size).toBe(0);expect(f.calls).not.toContain('post_task');
    } finally {await f.close();}
  });
  it('accepts a prompt longer than 2,500 bytes within the field limit',async()=>{
    const f=await fixture();try {
      const prompt='x'.repeat(3000);
      const result=await f.call('prepare',{input:{...spec,prompt}});
      expect(result.status).toBe(200);
      expect(result.draft.input.prompt).toBe(prompt);
      expect(f.posts.size).toBe(0);
    } finally {await f.close();}
  });
  it('recovers acceptance after an interrupted response and local server restart with one purchase and one reservation',async()=>{
    const f=await fixture();try {
      const {draft}=await f.call('prepare',{input:spec});
      expect(fs.statSync(path.join(f.dir,'drafts',`${draft.id}.json`)).mode & 0o777).toBe(0o600);
      f.disconnect(); const failed=await f.call('submit',{id:draft.id});expect(failed.status).toBe(400);
      expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_BODY');expect(f.posts.size).toBe(1);
      await f.restart(); const recovered=await f.call('submit',{id:draft.id});expect(recovered.draft.task_id).toBe('task_1');
      expect((await f.call('discard',{id:draft.id})).error.code).toBe('DRAFT_ALREADY_ATTEMPTED');
      await f.call('submit',{id:draft.id});expect(f.posts.size).toBe(1);expect(f.calls.filter(v=>v==='post_task')).toHaveLength(2);
      const ledger=JSON.parse(fs.readFileSync(f.budgetPath));expect(Object.keys(ledger.entries)).toHaveLength(2);
      expect(ledger.entries.baseline.booked_microusd).toBe(2390);
    } finally {await f.close();}
  });
  it('withholds unapproved/unverified answers and ciphertext, releasing the allowance only for deterministic approval',async()=>{
    const f=await fixture();try {
      const {draft}=await f.call('prepare',{input:spec});await f.call('submit',{id:draft.id});
      const result={task:{task_id:'task_1',status:'SUBMITTED',payment:{state:'HELD'}},
        result:{answer:'PRIVATE_SYNTHETIC_ANSWER',commitment_verified:true,result_enc_buyer:'CIPHERTEXT'},verdict:null};
      f.setResult(result);expect((await f.call('task',{task_id:'task_1'})).answer).toBeNull();
      result.task.status='APPROVED';result.result.commitment_verified=false;result.verdict={reason_code:'RUBRIC_MATCH'};
      f.setResult(result);const withheld=await f.call('task',{task_id:'task_1'});expect(withheld.answer).toBeNull();
      result.result.commitment_verified=true;f.setResult(result);const verified=await f.call('task',{task_id:'task_1'});
      expect(verified.answer).toBe('PRIVATE_SYNTHETIC_ANSWER');expect(JSON.stringify(verified)).not.toContain('CIPHERTEXT');
      expect(JSON.parse(fs.readFileSync(f.budgetPath)).entries[draft.id].booked_microusd).toBe(0);
    } finally {await f.close();}
  });
  it('blocks paused submissions and retains unknown allowances so repeated tests cannot exceed the shared $5 cap',async()=>{
    const f=await fixture();try {
      const {draft}=await f.call('prepare',{input:spec});fs.unlinkSync(f.policyPath);
      expect((await f.call('submit',{id:draft.id})).error.code).toBe('SUBMISSIONS_PAUSED');expect(f.posts.size).toBe(0);
      fs.writeFileSync(f.policyPath,JSON.stringify({endpoint:f.options.endpoint,judge_model:'claude-opus-5-5',max_attempts:3,submissions_enabled:true,valid_until:new Date(Date.now()+600000).toISOString()}));
      await f.call('submit',{id:draft.id});
      const second=await f.call('prepare',{input:spec});await f.call('submit',{id:second.draft.id});
      const third=await f.call('prepare',{input:spec});expect((await f.call('submit',{id:third.draft.id})).status).toBe(400);
      expect(f.posts.size).toBe(2);expect(Object.values(JSON.parse(fs.readFileSync(f.budgetPath)).entries).reduce((s,e)=>s+e.booked_microusd,0)).toBe(4402390);
    } finally {await f.close();}
  });
  it('can discard an unsubmitted draft without a payment or API reservation',async()=>{
    const f=await fixture();try {
      const {draft}=await f.call('prepare',{input:spec});expect((await f.call('discard',{id:draft.id})).discarded).toBe(true);
      expect((await f.call('state')).drafts).toEqual([]);expect(f.posts.size).toBe(0);
      expect(Object.keys(JSON.parse(fs.readFileSync(f.budgetPath)).entries)).toEqual(['baseline']);
    } finally {await f.close();}
  });
});

 describe('Google account buyer mode',()=>{
 it('uses server allowance without creating or editing a local budget',async()=>{const f=await fixture(true);try{fs.unlinkSync(f.budgetPath);fs.unlinkSync(f.policyPath);expect((await f.call('state')).submissions_enabled).toBe(true);const {draft}=await f.call('prepare',{input:spec});expect((await f.call('submit',{id:draft.id})).status).toBe(200);expect(f.posts.size).toBe(1);expect(fs.existsSync(f.budgetPath)).toBe(false);}finally{await f.close();}});
 it('rejects a mismatched signed-in owner',async()=>{const f=await fixture(true);try{f.options.getSession=()=>({user_id:'other'});await f.restart();expect((await f.call('state')).error.code).toBe('IDENTITY_MISMATCH');expect(f.posts.size).toBe(0);}finally{await f.close();}});
 });
