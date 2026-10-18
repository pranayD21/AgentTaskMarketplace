import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../src/marketplace.js',()=>({Marketplace:class{call=call;async listTools(){return [{name:'post_task',inputSchema:{type:'object',properties:{marketplace_only:{type:'boolean'}}}},{name:'register_agent',inputSchema:{}}];}async close(){}}}));
import {createDashboardChat} from '../src/dashboard-chat.js';
let root='';afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();if(root)fs.rmSync(root,{recursive:true,force:true});});
function setup(onAccepted?:(id:string)=>void){root=fs.mkdtempSync(path.join(os.tmpdir(),'atm-chat-'));fs.writeFileSync(path.join(root,'seller.json'),JSON.stringify({owner:{user_id:'human'},buyer_payment:{buyer_payment_status:'READY'}}));fs.writeFileSync(path.join(root,'buyer.json'),JSON.stringify({agent_id:'buyer',api_key:'private-key',owner:{user_id:'human'},marketplace_url:'http://market/mcp'}));return createDashboardChat({root,marketplaceUrl:'http://market/mcp',onAccepted});}
async function request(chat:ReturnType<typeof setup>,method:string,input?:unknown){let status=0,body='';const req=Readable.from(input?[JSON.stringify(input)]:[]) as any;req.method=method;req.url='/api/chat';await chat.handle(req,{writeHead(n:number){status=n;},end(s:string){body=s;}} as any);return {status,body:JSON.parse(body)};}
const account={kind:'buyer',agent_id:'buyer',owner:{user_id:'human'},buyer_payment:{buyer_payment_status:'READY'}};
it('always posts even a trivial request and returns only the verified worker answer without calling Ollama',async()=>{
 const chat=setup();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 call.mockImplementation(async(name:string)=>name==='whoami'?account:name==='get_result'?{task:{status:'APPROVED'},result:{answer:'42\n[ATM_TASK_COMPLETE]',commitment_verified:true}}:{task:{task_id:'task-1',status:name==='post_task'?'OPEN':'APPROVED',seller_id:'other-worker'}});
 expect((await request(chat,'POST',{prompt:'What is 6 times 7?',model:'qwen3:8b'})).status).toBe(202);
 await vi.waitFor(async()=>expect((await request(chat,'GET')).body.runs[0].status).toBe('finished'));
 const posts=call.mock.calls.filter(c=>c[0]==='post_task');expect(posts).toHaveLength(1);expect(posts[0][1]).toMatchObject({marketplace_only:true,price_cents:50,allowed_models:['qwen3:8b']});
 const data=(await request(chat,'GET')).body;expect(data.runs[0].events).toContainEqual(expect.objectContaining({type:'remote_answer',answer:'42',seller_id:'other-worker'}));expect(JSON.stringify(data)).not.toContain('private-key');expect(fetcher).not.toHaveBeenCalled();chat.close();
});
it('keeps an unclaimed request pending without a local fallback',async()=>{
 const chat=setup();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);call.mockImplementation(async(name:string)=>name==='whoami'?account:{task:{task_id:'task-2',status:'OPEN'}});
 await request(chat,'POST',{prompt:'Extract invoice total',model:'qwen3:8b'});
 await vi.waitFor(()=>expect(call.mock.calls.some(c=>c[0]==='get_task')).toBe(true));
 const data=(await request(chat,'GET')).body;expect(data.runs[0].status).toBe('running');expect(data.runs[0].events.some((e:any)=>e.type==='model'||e.type==='remote_answer')).toBe(false);expect(fetcher).not.toHaveBeenCalled();chat.close();await new Promise(r=>setTimeout(r,20));
});
it('does not display unverified output',async()=>{
 const chat=setup();call.mockImplementation(async(name:string)=>name==='whoami'?account:name==='get_result'?{task:{status:'APPROVED'},result:{answer:'unverified',commitment_verified:false}}:{task:{task_id:'task-3',status:'APPROVED'}});
 await request(chat,'POST',{prompt:'hello',model:'qwen3:8b'});await vi.waitFor(()=>expect(call.mock.calls.some(c=>c[0]==='get_result')).toBe(true));expect((await request(chat,'GET')).body.runs[0].events.some((e:any)=>e.type==='remote_answer')).toBe(false);chat.close();await new Promise(r=>setTimeout(r,20));
});
it('rejects a buyer belonging to another signed-in owner',async()=>{const chat=setup();fs.writeFileSync(path.join(root,'seller.json'),JSON.stringify({owner:{user_id:'other'}}));expect((await request(chat,'POST',{prompt:'hello',model:'local'})).status).toBe(400);expect(call).not.toHaveBeenCalled();chat.close();});

it('blocks chat before model execution when Stripe buying is incomplete',async()=>{const chat=setup();call.mockResolvedValue({kind:'buyer',agent_id:'buyer',owner:{user_id:'human'},buyer_payment:{buyer_payment_status:'SETUP_REQUIRED'}});const fetcher=vi.fn(async()=>Response.json({models:[{name:'local'}]}));vi.stubGlobal('fetch',fetcher);const result=await request(chat,'POST',{prompt:'hello',model:'local'});expect(result.status).toBe(402);expect(fetcher).not.toHaveBeenCalled();expect(fs.existsSync(path.join(root,'chat-history.json'))).toBe(false);chat.close();});

it('retries an uncertain post with the same persisted idempotency key',async()=>{
 const chat=setup();let attempts=0;
 call.mockImplementation(async(name:string,args:any)=>{
  if(name==='whoami')return account;
  if(name==='post_task'){
   const saved=JSON.parse(fs.readFileSync(path.join(root,'chat-history.json'),'utf8'));
   expect(saved[0].posts.request.args.client_request_id).toBe(args.client_request_id);
   if(attempts++===0)throw Error('response lost');
  }
  if(name==='get_result')return {task:{status:'APPROVED'},result:{answer:'done',commitment_verified:true}};
  return {task:{task_id:'same-task',status:'APPROVED',seller_id:'other'}};
 });
 await request(chat,'POST',{prompt:'A small request',model:'qwen3:8b'});
 await vi.waitFor(async()=>expect((await request(chat,'GET')).body.runs[0].status).toBe('finished'),{timeout:3000});
 const posts=call.mock.calls.filter(c=>c[0]==='post_task');expect(posts).toHaveLength(2);expect(posts[0][1].client_request_id).toBe(posts[1][1].client_request_id);chat.close();
});

it('shows submitted output as pending and opens the confirmed claim once',async()=>{
 const open=vi.fn(),chat=setup(open);
 call.mockImplementation(async(name:string)=>name==='whoami'?account:name==='get_result'?{task:{status:'SUBMITTED'},result:{answer:'Pending answer\n[ATM_TASK_COMPLETE]',commitment_verified:true}}:{task:{task_id:'task_pending',status:name==='post_task'?'OPEN':'SUBMITTED',seller_id:'other',claim_id:'claim-1'}});
 await request(chat,'POST',{prompt:'Invoice extraction',model:'qwen3:8b'});
 await vi.waitFor(async()=>expect((await request(chat,'GET')).body.runs[0].events.some((e:any)=>e.type==='remote_preview')).toBe(true));
 const run=(await request(chat,'GET')).body.runs[0];expect(run.status).toBe('running');expect(run.events).toContainEqual(expect.objectContaining({type:'remote_preview',answer:'Pending answer',status:'SUBMITTED'}));expect(run.events.some((e:any)=>e.type==='remote_answer')).toBe(false);expect(open).toHaveBeenCalledExactlyOnceWith('task_pending');
 chat.close();await new Promise(r=>setTimeout(r,20));
});
it('posts two independent tasks under one capped job and completes only with both outputs',async()=>{
 const chat=setup();const posts:any[]=[];
 call.mockImplementation(async(name:string,args:any)=>{
  if(name==='whoami')return account;
  if(name==='create_job'){expect(args.budget_cents).toBe(100);return {job:{job_id:'job-two'}};}
  if(name==='post_task'){posts.push(args);return {task:{task_id:'task_'+posts.length,status:'OPEN'}};}
  if(name==='get_result')return {task:{status:'APPROVED'},result:{answer:'Output '+args.task_id,commitment_verified:true}};
  return {task:{task_id:args.task_id,status:'APPROVED',seller_id:'other'}};
 });
 await request(chat,'POST',{prompt:'Reconcile East invoices\n---TASK---\nReconcile West invoices',model:'qwen3:8b'});
 await vi.waitFor(async()=>expect((await request(chat,'GET')).body.runs[0].status).toBe('finished'));
 expect(posts).toHaveLength(2);expect(new Set(posts.map(p=>p.client_request_id)).size).toBe(2);expect(posts.every(p=>p.job_id==='job-two'&&p.price_cents===50&&p.marketplace_only)).toBe(true);
 expect((await request(chat,'GET')).body.runs[0].events.filter((e:any)=>e.type==='remote_answer')).toHaveLength(2);chat.close();
});
it('rejects more than four parts before posting',async()=>{const chat=setup();expect((await request(chat,'POST',{prompt:Array(5).fill('task').join('\n---TASK---\n'),model:'qwen3:8b'})).status).toBe(400);expect(call).not.toHaveBeenCalled();chat.close();});
