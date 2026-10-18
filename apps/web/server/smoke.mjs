#!/usr/bin/env node
// Isolated real-MCP human-buyer flow. MEMORY/MOCK, deterministic model, no external providers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeypair, toB64 } from '../../../packages/crypto/src/index.ts';
import { createRunner } from '../../../packages/runner-core/src/index.ts';
import { createClient } from '../../../scripts/buyer.mjs';
import { createBuyerBridge } from './buyer.mjs';

const root=path.resolve(import.meta.dirname,'../../..');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atm-web-flow-'));
let child, bridge;
let phase='startup';
async function listen(server) {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server.address().port;}
try {
  const probe=http.createServer();const port=await listen(probe);await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`,endpoint=`${origin}/mcp`;
  const judgeKey=generateKeypair(),judgeSecret=randomBytes(24).toString('hex');
  child=spawn(process.execPath,['node_modules/mcp-use/dist/bin.js','dev','--port',String(port),'--no-open','--no-inspector'],{
    cwd:path.join(root,'apps/marketplace-mcp'),detached:true,stdio:'ignore',env:{...process.env,
      DB_MODE:'memory',PAYMENT_MODE:'mock',INKBOX_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_PROFILE_ID:'',ANTHROPIC_API_KEY:'',
      INSFORGE_API_KEY:'isolated-unused',INSFORGE_BASE_URL:'http://127.0.0.1:1',SERVER_KEK_B64:randomBytes(32).toString('base64'),
      JUDGE_PUBLIC_KEY_B64:toB64(judgeKey.publicKey),JUDGE_KEY_ID:'judge-web-fixture',JUDGE_REGISTRATION_SECRET:judgeSecret,
      BASE_URL:origin,PORT:String(port)}});
  let healthy=false;
  for(let i=0;i<80;i++) {try {const h=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(h.payments==='mock'&&h.db.startsWith('MEMORY')){healthy=true;break;}}catch{}await delay(250);}
  assert.ok(healthy);
  const publicClient=createClient(endpoint);await publicClient.initialize();
  const buyer=await publicClient.tool('register_agent',{kind:'buyer',display_name:'web-flow-fixture',spend_cap_cents:200});
  const statePath=path.join(directory,'buyer.json'),budgetPath=path.join(directory,'budget.json'),policyPath=path.join(directory,'policy.json');
  await fs.writeFile(statePath,JSON.stringify({marketplace_url:endpoint,agent_id:buyer.agent_id,api_key:buyer.api_key}),{mode:0o600});
  await fs.writeFile(budgetPath,JSON.stringify({schema:'atm-api-budget/v1',cap_microusd:5000000,entries:{}}),{mode:0o600});
  await fs.writeFile(policyPath,JSON.stringify({endpoint,judge_model:'claude-opus-5-5',max_attempts:3,submissions_enabled:true,valid_until:new Date(Date.now()+600000).toISOString()}),{mode:0o600});
  const middleware=createBuyerBridge({endpoint,statePath,budgetPath,policyPath,journalDir:path.join(directory,'drafts')});
  bridge=http.createServer((req,res)=>void middleware(req,res,()=>{res.statusCode=404;res.end();}));
  const local=`http://127.0.0.1:${await listen(bridge)}`;
  const {token}=await fetch(`${local}/api/buyer`,{headers:{origin:local}}).then(r=>r.json());
  async function call(action,args={}) {const r=await fetch(`${local}/api/buyer`,{method:'POST',headers:{origin:local,'content-type':'application/json','x-atm-csrf':token},body:JSON.stringify({action,...args})});assert.equal(r.status,200,`bridge ${action} failed`);return r.json();}
  phase='draft and submission';
  const input={prompt:'Return the fixture success marker.',context:'Synthetic local bridge verification.',allowed_models:['qwen3:8b'],price_cents:100,max_runtime_s:180,expires_in_s:3600,max_tokens:64,rubric:{kind:'contains_text',expected_text:'READY'}};
  const prepared=await call('prepare',{input});const submitted=await call('submit',{id:prepared.draft.id});
  const taskId=submitted.draft.task_id;assert.ok(taskId);
  assert.equal((await call('submit',{id:prepared.draft.id})).draft.task_id,taskId);
  const state=await call('state');assert.equal(state.tasks.length,1);assert.equal(state.buyer.spend.reserved_cents,100);
  phase='seller and judge';
  const sellerId=await publicClient.tool('register_agent',{kind:'seller',display_name:'web-flow-seller'});
  const seller=createClient(endpoint,sellerId.api_key);await seller.initialize();
  await seller.tool('register_seller',{models:[{model_id:'qwen3:8b'}],runtime:'node-unsandboxed'});
  const host={getSecret:async()=>undefined,now:Date.now,fetch:async url=>new Response(JSON.stringify(String(url).endsWith('/api/tags')?{models:[{name:'qwen3:8b',digest:'synthetic'}]}:{message:{content:'READY'},eval_count:1}),{headers:{'content-type':'application/json'}})};
  const runner=createRunner(host),key=runner.getPublicKey();
  const {claim}=await seller.tool('claim_task',{task_id:taskId,model_id:'qwen3:8b',runner_pubkey_b64:key.public_key_b64,runner_key_id:key.key_id});
  const {seller_usage,...produced}=await runner.runTask(claim.seller_envelope,{ollama_url:'http://fixture.invalid',model_id:claim.model_id,buyer_public_key:claim.buyer_public_key,judge_public_key:claim.judge_public_key});
  await seller.tool('submit_result',{task_id:claim.task_id,claim_id:claim.claim_id,...produced});
  const pending=await call('task',{task_id:taskId});assert.equal(pending.answer,null);assert.equal(pending.commitment_verified,true);
  const judgeId=await publicClient.tool('register_agent',{kind:'judge',display_name:'web-flow-judge',judge_secret:judgeSecret});
  const judge=createClient(endpoint,judgeId.api_key);await judge.initialize();
  const {package:pkg}=await judge.tool('fetch_review_package');
  const judgeHost={getSecret:async name=>name==='JUDGE_PRIVATE_KEY_B64'?toB64(judgeKey.secretKey):undefined,now:Date.now,fetch:async()=>{throw new Error('Unexpected provider request');}};
  const verdict=await createRunner(judgeHost).judgeTask(pkg.payload_enc_judge,pkg.result_enc_judge,{buyer_public_key:pkg.buyer_public_key,commitment_sha256:pkg.commitment_sha256},judgeKey);
  const {judge_usage,...verdictFields}=verdict;
  await judge.tool('submit_verdict',{task_id:taskId,result_id:pkg.result_id,...verdictFields});
  phase='verified result';
  const final=await call('task',{task_id:taskId});assert.equal(final.task.status,'APPROVED');assert.equal(final.answer,'READY');assert.equal(final.commitment_verified,true);
  const balance=(await call('state')).buyer.spend;assert.equal(balance.spent_cents,100);assert.equal(balance.reserved_cents,0);
  const ledger=JSON.parse(await fs.readFile(budgetPath,'utf8'));assert.equal(ledger.entries[prepared.draft.id].booked_microusd,0);
  const evidence={checked_at:new Date().toISOString(),mode:'MEMORY/MOCK',runtime:'node-unsandboxed',model:'deterministic synthetic fixture',
    task_id:taskId,task_count:1,status:final.task.status,commitment_verified:true,answer_withheld_until_approved:true,
    duplicate_submit_same_task:true,buyer_spent_mock_cents:100,buyer_reserved_mock_cents:0,api_calls:0,api_reservation_released:true};
  await fs.writeFile(path.join(root,'docs/buyer/runs/web-buyer-smoke.json'),`${JSON.stringify(evidence,null,2)}\n`);
  console.log(JSON.stringify(evidence));
} catch {console.error(`Isolated web buyer flow failed at ${phase}; private payloads omitted`);process.exitCode=1;}
finally {if(bridge)await new Promise(resolve=>bridge.close(resolve));if(child?.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}await fs.rm(directory,{recursive:true,force:true});}
