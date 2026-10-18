import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Marketplace } from './marketplace.js';
import { type AgentEvent } from './buyer-agent.js';

type Post = { args: Record<string, unknown>; task_id?: string };
type Run = { id:string; owner_id:string; buyer_id:string; prompt:string; model:string; status:string; events:AgentEvent[]; task_ids:string[]; posts:Record<string,Post>; jobs:string[]; error?:string };
const marker='[ATM_TASK_COMPLETE]';
const taskInput=(prompt:string)=>({prompt,context:`Complete the user's request. Append ${marker} on a separate final line after your answer. This marker checks completion format only, not correctness.`,rubric:{kind:'contains_text',expected_text:marker}});
const read = (file:string) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
const save = (file:string,value:unknown) => { const tmp=file+'.'+randomUUID();fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,file); };
const terminal = new Set(['APPROVED','REJECTED','CANCELLED','EXPIRED']);
export function createDashboardChat(options:{root:string;marketplaceUrl:string}) {
 const file=path.join(options.root,'chat-history.json');
 const runs:Run[]=read(file)??[];
 for(const run of runs)if(run.status==='running')run.status='interrupted';
 const active=new Map<string,AbortController>();
 const persist=()=>save(file,runs);
 const identity=()=>{const buyer=read(path.join(options.root,'buyer.json'));const seller=read(path.join(options.root,'seller.json'));if(!buyer?.owner?.user_id||buyer.owner.user_id!==seller?.owner?.user_id||buyer.marketplace_url!==options.marketplaceUrl)throw Error('Sign in with Google to use chat.');return buyer;};
 const emit=(run:Run,event:AgentEvent)=>{run.events.push(event);if(run.events.length>400)run.events.splice(0,run.events.length-400);persist();};
 const event=(run:Run,type:string,data:Record<string,unknown>)=>emit(run,{type,at:new Date().toISOString(),...data});
 async function execute(run:Run,buyer:any,controller:AbortController){
  const mp=new Marketplace(options.marketplaceUrl,buyer.api_key),deadline=Date.now()+10*60_000;
  const timer=setTimeout(()=>controller.abort(),10*60_000);
  try {
   const who:any=await mp.call('whoami',{},controller.signal);
   if(who.kind!=='buyer'||who.agent_id!==buyer.agent_id||who.owner?.user_id!==buyer.owner.user_id)throw Error('Account ownership could not be verified.');
   const schemas=await mp.listTools();
   if(!(schemas.find(s=>s.name==='post_task')?.inputSchema as any)?.properties?.marketplace_only)throw Error('Marketplace upgrade required.');
   const post=run.posts.request??{args:{...taskInput(run.prompt),allowed_models:[run.model],price_cents:50,max_runtime_s:300,expires_in_s:600,max_tokens:2048,marketplace_only:true,client_request_id:run.id}};
   run.posts.request=post;persist();
   event(run,'tool_call',{name:'mcp_post_task',arguments:{price_cents:50,marketplace_only:true}});
   // Persist the idempotency key before any network request. Never fall back to local inference.
   let result:any;
   for(let attempt=0;attempt<3;attempt++){
    try{result=await mp.call('post_task',post.args,controller.signal);break;}
    catch(error){if(controller.signal.aborted||attempt===2)throw error;await delay(1000,undefined,{signal:controller.signal});}
   }
   if(!result?.task?.task_id)throw Error('Marketplace did not return a task ID.');
   post.task_id=result.task.task_id;run.task_ids=[post.task_id!];persist();
   event(run,'task_status',{task:result.task});
   while(!controller.signal.aborted&&Date.now()<deadline){
    await updateTask(mp,run,post.task_id!,controller.signal);
    if(['finished','failed'].includes(run.status))return;
    await delay(3000,undefined,{signal:controller.signal});
   }
   run.status='waiting';
  }catch{run.status=controller.signal.aborted?'stopped':'failed';run.error=controller.signal.aborted?'Chat stopped. Posted tasks remain visible and may still finish.':'Marketplace posting or tracking failed. No local answer was generated. Existing task IDs remain visible; do not resubmit an uncertain post.';}
  finally{clearTimeout(timer);active.delete(run.id);persist();await mp.close();}
 }
 async function updateTask(mp:Marketplace,run:Run,id:string,signal:AbortSignal){
  const previous=run.events.filter(e=>e.type==='task_status'&&(e.task as any)?.task_id===id).at(-1)?.task as any;
  const result:any=await mp.call('get_task',{task_id:id},signal);const task=result.task??result;
  if(task.status!==previous?.status||task.seller_id!==previous?.seller_id)event(run,'task_status',{task});
  if(task.status==='APPROVED'&&!run.events.some(e=>e.type==='remote_answer'&&e.task_id===id)){
   const output:any=await mp.call('get_result',{task_id:id},signal);
   if(output.task?.status==='APPROVED'&&output.result?.commitment_verified===true&&typeof output.result.answer==='string'){
    const answer=output.result.answer.replace(/\s*\[ATM_TASK_COMPLETE\]\s*$/,'');
    event(run,'remote_answer',{task_id:id,seller_id:task.seller_id,answer});run.status='finished';delete run.error;persist();
   }
  }else if(terminal.has(task.status)&&task.status!=='APPROVED'){run.status='failed';run.error=`Marketplace task ${task.status.toLowerCase()}. No local answer was generated.`;persist();}
 }
 let refreshed=0;
 async function refresh(buyer:any){
  if(Date.now()-refreshed<3000)return;refreshed=Date.now();
  const mp=new Marketplace(options.marketplaceUrl,buyer.api_key);
  try{for(const run of runs.filter(r=>r.buyer_id===buyer.agent_id).slice(-10))for(const id of run.task_ids){
   if(active.has(run.id)||run.events.some(e=>e.type==='remote_answer'&&e.task_id===id))continue;
   await updateTask(mp,run,id,AbortSignal.timeout(8000));
  }}catch{/* Keep the last verified state; next poll retries. */}finally{await mp.close();}
 }
 return {async handle(req:IncomingMessage,res:ServerResponse){
  const route=(req.url??'').split('?')[0];if(!['/api/chat','/api/chat/stop'].includes(route!))return false;
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   const buyer=identity();
   if(req.method==='GET'&&route==='/api/chat'){
    await refresh(buyer);json(200,{runs:runs.filter(r=>r.buyer_id===buyer.agent_id).map(({owner_id,buyer_id,posts,jobs,...publicRun})=>publicRun)});return true;
   }
   if(req.method!=='POST'){json(405,{error:'Method not allowed.'});return true;}
   let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>20000)throw Error('Message is too long.');}const input=JSON.parse(body);
   if(route==='/api/chat/stop'){const run=runs.find(r=>r.id===input.id&&r.buyer_id===buyer.agent_id);if(run)active.get(run.id)?.abort();json(200,{ok:true});return true;}
   if(active.size){json(409,{error:'Wait for the current chat or stop it first.'});return true;}
   if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>12000)throw Error('Enter a message of up to 12000 characters.');
   if(typeof input.model!=='string'||!input.model.trim())throw Error('Choose a worker model.');
   if(Buffer.byteLength(JSON.stringify(taskInput(input.prompt)))>2500)throw Error('Message is too long for the marketplace. Shorten it and try again.');
   const gate=new Marketplace(options.marketplaceUrl,buyer.api_key);
   try {const account:any=await gate.call('whoami');if(account.kind!=='buyer'||account.agent_id!==buyer.agent_id||account.owner?.user_id!==buyer.owner.user_id)throw Error('Sign in with the account owner.');if(!['READY','MOCK'].includes(account.buyer_payment?.buyer_payment_status)){json(402,{error:'Complete Stripe buying setup before sending requests.'});return true;}}finally{await gate.close();}
   const run:Run={id:randomUUID(),owner_id:buyer.owner.user_id,buyer_id:buyer.agent_id,prompt:input.prompt,model:input.model,status:'running',events:[],task_ids:[],posts:{},jobs:[]};
   runs.push(run);if(runs.length>30)runs.shift();persist();const controller=new AbortController();active.set(run.id,controller);void execute(run,buyer,controller);json(202,{id:run.id});
  }catch(error){json(400,{error:error instanceof Error&&/^(Sign in|Message|Enter a message|Choose a worker)/.test(error.message)?error.message:'Chat is unavailable. Check your account and marketplace connection.'});}
  return true;
 },close(){for(const controller of active.values())controller.abort();}};
}
