import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../src/marketplace.js',()=>({Marketplace:class{call=call;async listTools(){return ['post_task','get_task','get_result','create_job','marketplace_info','whoami','list_sellers'].map(name=>({name,inputSchema:{type:'object',properties:{marketplace_only:{type:'boolean'},api_key:{type:'string'}}}}));}async close(){}}}));
import {createDashboardChat} from '../src/dashboard-chat.js';
let root='';let chat:ReturnType<typeof createDashboardChat>;
afterEach(async()=>{chat?.close();await new Promise(r=>setTimeout(r,30));vi.unstubAllGlobals();vi.clearAllMocks();if(root)fs.rmSync(root,{recursive:true,force:true});});
function setup(onAccepted?:(id:string)=>void){root=fs.mkdtempSync(path.join(os.tmpdir(),'atm-chat-'));fs.writeFileSync(path.join(root,'seller.json'),JSON.stringify({owner:{user_id:'human'}}));fs.writeFileSync(path.join(root,'buyer.json'),JSON.stringify({agent_id:'buyer',api_key:'private-key',owner:{user_id:'human'},marketplace_url:'http://market/mcp'}));chat=createDashboardChat({root,marketplaceUrl:'http://market/mcp',onAccepted});return chat;}
async function request(method:string,input?:unknown){let status=0,body='';const req=Readable.from(input?[JSON.stringify(input)]:[]) as any;req.method=method;req.url='/api/chat';await chat.handle(req,{writeHead(n:number){status=n;},end(s:string){body=s;}} as any);return {status,body:JSON.parse(body)};}
const account={kind:'buyer',agent_id:'buyer',owner:{user_id:'human'},buyer_payment:{buyer_payment_status:'READY'}};
const tc=(name:string,args:any)=>({function:{name,arguments:args}});
function model(turns:any[]){turns=turns.flatMap(turn=>turn.tool_calls?.length?turn.tool_calls.map((call:any)=>({role:'assistant',content:JSON.stringify({action:'tool',tool:call.function.name,arguments:call.function.arguments})})):[{role:'assistant',content:JSON.stringify({action:'final',answer:turn.content||'Done'})}]);const seen:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:8b'}]});if(url.endsWith('/api/show'))return Response.json({capabilities:['tools','thinking']});if(url.endsWith('/api/ps'))return Response.json({models:[]});seen.push(JSON.parse(init.body));return Response.json({message:{role:'assistant',content:'',...turns.shift()}});}));return seen;}
it('lets the local model answer a small request without forced marketplace posts',async()=>{setup();call.mockResolvedValue(account);const seen=model([{content:'42',thinking:'Simple arithmetic.'}]);expect((await request('POST',{prompt:'6 times 7?',model:'qwen3:8b'})).status).toBe(202);await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));expect(call.mock.calls.filter(c=>c[0]==='post_task')).toHaveLength(0);expect(seen[0].think).toBe(false);expect(JSON.stringify((await request('GET')).body)).not.toContain('private-key');});
it('uses model-designed subtasks, continues local work and resumes with both verified results',async()=>{
 setup();const posts:any[]=[];
 call.mockImplementation(async(name:string,args:any)=>{if(name==='whoami')return account;if(name==='post_task'){posts.push(args);return {task:{task_id:'task_'+posts.length,status:'OPEN'}};}if(name==='get_result')return {task:{status:'APPROVED'},result:{answer:'Checked '+args.task_id,commitment_verified:true}};return {task:{task_id:args.task_id,status:'APPROVED',seller_id:'other'}};});
 const seen=model([{tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Check East ledger',allowed_models:['qwen3:8b']},{prompt:'Check West ledger',allowed_models:['qwen3:8b']}]})]},{content:'While the workers reconcile each ledger, I will define the combined report.'},{content:'Report outline drafted locally while workers run.'},{content:'Combined report from both checked ledgers.'}]);
 await request('POST',{prompt:'Reconcile both branches and explain the combined findings.',model:'qwen3:8b'});
 await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));
 expect((await request('GET')).body.runs[0].task_prompts).toEqual({task_1:'Check East ledger',task_2:'Check West ledger'});expect(posts).toHaveLength(2);expect(posts.map(p=>p.prompt)).toEqual(['Check East ledger','Check West ledger']);expect(posts.every(p=>p.marketplace_only&&p.price_cents===50)).toBe(true);expect(JSON.stringify(seen.map(s=>s.messages))).toContain('Checked task_2');expect((await request('GET')).body.runs[0].events.filter((e:any)=>e.type==='remote_answer')).toHaveLength(2);
});
it('enforces task count, per-request spend, ownership and strips supplied credentials',async()=>{
 setup();call.mockImplementation(async(name:string)=>name==='whoami'?account:{task:{task_id:'task_cap',status:'EXPIRED'}});
 const seen=model([{tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Work',price_cents:201,api_key:'injected'}]}),tc('mcp_get_task',{task_id:'not-owned'}),tc('mcp_whoami',{api_key:'injected'})]},{content:'Cannot exceed limits.'}]);
 await request('POST',{prompt:'Work',model:'qwen3:8b'});await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));expect(call.mock.calls.some(c=>c[0]==='post_task')).toBe(false);expect(call.mock.calls.some(c=>c[0]==='get_task')).toBe(false);expect(call.mock.calls.some(c=>c[1]?.api_key)).toBe(false);expect(JSON.stringify(seen.map(s=>s.messages))).toContain('50–100');
});
it('reuses the same persisted idempotency key after a lost post response',async()=>{
 setup();let attempts=0;call.mockImplementation(async(name:string,args:any)=>{if(name==='whoami')return account;if(name==='post_task'){const saved=JSON.parse(fs.readFileSync(path.join(root,'chat-history.json'),'utf8'));expect(Object.values(saved[0].posts).some((p:any)=>p.args.client_request_id===args.client_request_id)).toBe(true);if(attempts++===0)throw Error('response lost');}return {task:{task_id:'task_retry',status:'EXPIRED'}};});
 const tool=tc('delegate_tasks',{tasks:[{prompt:'Check ledger',allowed_models:['qwen3:8b']}]});model([{tool_calls:[tool]},{tool_calls:[tool]},{content:'Waiting'},{content:'Expired'}]);await request('POST',{prompt:'Reconcile',model:'qwen3:8b'});await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));const posts=call.mock.calls.filter(c=>c[0]==='post_task');expect(posts).toHaveLength(2);expect(posts[0][1].client_request_id).toBe(posts[1][1].client_request_id);
});
it('blocks execution before model access when Stripe buying is incomplete',async()=>{setup();call.mockResolvedValue({...account,buyer_payment:{buyer_payment_status:'SETUP_REQUIRED'}});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect((await request('POST',{prompt:'Hi',model:'local'})).status).toBe(402);expect(fetcher).not.toHaveBeenCalled();});
it('rejects a buyer belonging to another Google owner',async()=>{setup();fs.writeFileSync(path.join(root,'seller.json'),JSON.stringify({owner:{user_id:'other'}}));expect((await request('POST',{prompt:'Hi',model:'local'})).status).toBe(400);expect(call).not.toHaveBeenCalled();});
it('shows pending output without promoting it, opens a claim once and allows another conversation',async()=>{
 const open=vi.fn();setup(open);call.mockImplementation(async(name:string)=>name==='whoami'?account:name==='get_result'?{task:{status:'SUBMITTED'},result:{answer:'Preview',commitment_verified:true}}:{task:{task_id:'task_pending',status:name==='post_task'?'OPEN':'SUBMITTED',seller_id:'other',claim_id:'claim-1'}});model([{tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Check',allowed_models:['qwen3:8b']}]})]},{content:'Waiting'},{content:'Nothing more to do locally.'},{content:'A separate answer'}]);await request('POST',{prompt:'Work',model:'qwen3:8b',conversation_id:'first'});
 await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].events.some((e:any)=>e.type==='remote_preview')).toBe(true));expect(open).toHaveBeenCalledExactlyOnceWith('task_pending');expect((await request('POST',{prompt:'Again',model:'qwen3:8b',conversation_id:'first'})).status).toBe(409);expect((await request('POST',{prompt:'Other',model:'qwen3:8b',conversation_id:'second'})).status).toBe(202);await vi.waitFor(async()=>expect((await request('GET')).body.runs[1].status).toBe('finished'));expect((await request('GET')).body.runs[0].events.some((e:any)=>e.type==='remote_answer')).toBe(false);
});
it('supports a non-thinking model without native tool calling using structured actions',async()=>{
 setup();call.mockResolvedValue(account);const seen:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:'local'}]});if(url.endsWith('/api/show'))return Response.json({capabilities:['completion']});seen.push(JSON.parse(init.body));return Response.json({message:{role:'assistant',content:JSON.stringify({action:'final',answer:'Hello'})}});}));
 expect((await request('POST',{prompt:'Hello',model:'local'})).status).toBe(202);await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));
 expect(seen[0].think).toBeUndefined();expect(seen[0].tools).toBeUndefined();expect(seen[0].format.oneOf).toBeDefined();expect((await request('GET')).body.runs[0].events.some((e:any)=>e.type==='marketplace_connected')).toBe(true);
});
it('removes invented job metadata and releases only confirmed validation failures',async()=>{
 setup();let attempts=0;
 call.mockImplementation(async(name:string,args:any)=>{if(name==='whoami')return account;if(name==='post_task'){expect(args.job_id).toBeUndefined();expect(args.part_key).toBeUndefined();if(attempts++<4)throw Object.assign(Error('Invalid model'),{code:'VALIDATION_ERROR'});return {task:{task_id:'task_valid',status:'EXPIRED'}};}return {task:{task_id:args.task_id,status:'EXPIRED'}};});
 const turns=Array.from({length:5},(_,i)=>({tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Check ledger '+i,allowed_models:['qwen3:8b'],part_key:'invented',job_id:'invented'}]})]}));
 const seen=model([...turns,{content:'Waiting'},{content:'Expired'}]);await request('POST',{prompt:'Review',model:'qwen3:8b'});await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));
 expect(attempts).toBe(5);const saved=JSON.parse(fs.readFileSync(path.join(root,'chat-history.json'),'utf8'));expect(Object.keys(saved[0].posts)).toHaveLength(1);
 const postTool=seen[0].format.oneOf.find((t:any)=>t.properties.tool?.const==='delegate_tasks');expect(postTool.properties.arguments.properties.tasks.items.properties.job_id).toBeUndefined();
});
it('inspects a failed remote result, delegates a correction and integrates the replacement in the same run',async()=>{
 setup();const posts:any[]=[];
 call.mockImplementation(async(name:string,args:any)=>{
  if(name==='whoami')return account;
  if(name==='list_sellers')return {sellers:[{status:'ACTIVE',models:[{model_id:'qwen3:8b'}]}]};
  if(name==='post_task'){posts.push(args);return {task:{task_id:'task_'+posts.length,status:'OPEN'}};}
  if(name==='get_result')return {task:{status:args.task_id==='task_1'?'REJECTED':'APPROVED'},result:{answer:'Corrected deliverable',commitment_verified:true}};
  return {task:{task_id:args.task_id,status:args.task_id==='task_1'?'REJECTED':'APPROVED'}};
 });
 const seen=model([{tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Independent initial work'}]})]},{content:'Wait for the result.'},{tool_calls:[tc('delegate_tasks',{tasks:[{prompt:'Correct the missing validation in the initial work'}]})]},{content:'Wait for the correction.'},{content:'Integrated corrected deliverable.'}]);
 await request('POST',{prompt:'Help make this reliable',model:'qwen3:8b'});await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));
 expect(posts).toHaveLength(2);expect(posts[0].allowed_models).toEqual(['qwen3:8b']);expect(posts[0].price_cents).toBe(50);expect(posts[1].prompt).toContain('Correct');expect(JSON.stringify(seen.map(s=>s.messages))).toContain('REJECTED');expect(JSON.stringify(seen.map(s=>s.messages))).toContain('posted_tasks');expect(JSON.stringify(seen.map(s=>s.messages))).toContain('results arrived');expect((await request('GET')).body.runs[0].events.filter((e:any)=>e.type==='resumed')).toHaveLength(2);
});
it('posts a repeated prompt to another worker but reuses the reservation after a lost response',async()=>{
 setup();let n=0;
 call.mockImplementation(async(name:string,args:any)=>{if(name==='whoami')return account;if(name==='post_task'){n++;if(n===1)throw Error('response lost');return {task:{task_id:'task_'+args.client_request_id.slice(-6),status:'EXPIRED'}};}return {task:{task_id:args.task_id,status:'EXPIRED'}};});
 const task={prompt:'Verify the proof',allowed_models:['qwen3:8b']};
 model([{tool_calls:[tc('delegate_tasks',{tasks:[task,task]})]},{tool_calls:[tc('delegate_tasks',{tasks:[task]})]},{content:'Waiting'},{content:'Expired'}]);
 await request('POST',{prompt:'Have two workers verify this',model:'qwen3:8b'});await vi.waitFor(async()=>expect((await request('GET')).body.runs[0].status).toBe('finished'));
 const keys=call.mock.calls.filter(c=>c[0]==='post_task').map(c=>c[1].client_request_id);
 expect(keys).toHaveLength(3);expect(keys[0]).not.toBe(keys[1]);expect(keys[2]).toBe(keys[0]);
 expect(JSON.parse(fs.readFileSync(path.join(root,'chat-history.json'),'utf8'))[0].task_ids).toHaveLength(2);
});
