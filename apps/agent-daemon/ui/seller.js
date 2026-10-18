const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gb = bytes => `${(Number(bytes || 0)/1024**3).toFixed(1)} GB`;
let data, posting = false;
const error = message => { $('error').textContent = message || ''; $('error').hidden = !message; };
const complete = (id, done, number) => { $(id).classList.toggle('done', done); $(id).textContent = done ? '✓' : number; };
async function post(route) {
 const r = await fetch(route,{method:'POST',headers:{'X-ATM-Request':'1'}}); const j = await r.json(); if(!r.ok) throw Error(j.error || 'Could not finish. Please try again.'); return j;
}
async function refresh() {
 try {
  const r=await fetch('/api/status'); if(!r.ok) throw Error('Open this dashboard again with atm-seller dashboard.'); data=await r.json();
  const m=data.machine,w=data.worker,hasOwner=Boolean(data.owner),prepared=Boolean(w.prepared),paid=w.payout_status==='ACTIVE',running=w.service==='running',buyReady=['READY','MOCK'].includes(data.buyer_payment?.buyer_payment_status);
  $('connection').textContent=m.ollama_online?'●  Connected to your Mac':'●  Ollama is offline';
  $('chip').textContent=m.chip; $('host').textContent=m.hostname; $('model-host').textContent=m.hostname;
  $('cores').textContent=m.cpu_cores; $('load').textContent=`1-minute load: ${Number(m.load_average_1m).toFixed(2)}`;
  $('memory').textContent=gb(m.memory_bytes);$('free').textContent=`${gb(m.free_memory_bytes)} free physical memory`;
  $('approvals').textContent=w.approvals??'—'; $('activity').textContent=running?'Worker running · approved tasks':'Worker stopped · approved tasks';
  $('ollama').textContent=m.ollama_online?'Ollama connected':'Ollama offline';
  $('google-detail').textContent=hasOwner&&!data.buyer_id?`Signed in as ${data.owner.email}. Sign in once more to enable chat and buying for this existing account.`:hasOwner?`Signed in as ${data.owner.email}`:'One Google login connects buying and selling.';
  $('google').textContent=hasOwner&&!data.buyer_id?'Enable chat with Google ↗':hasOwner?'Sign in again':'Continue with Google ↗'; $('google').disabled=posting||data.busy;
  $('model-detail').textContent=prepared?'Local model passed its liveness check in the Wasm sandbox.':'Uses a supported installed model, or downloads Qwen3 8B (about 5.2 GB).';
  $('prepare').textContent=data.busy?'Preparing…':prepared?'Check model again':'Prepare model';$('prepare').disabled=posting||!hasOwner||data.busy||running;
  $('stripe-detail').textContent=paid?'Stripe test transfer capability is active. This does not confirm a real bank payout.':prepared?'Complete Stripe’s hosted payout setup for this seller account.':'Prepare your model to create your Stripe payout account.';
  $('stripe').textContent=paid?'Check Stripe status':'Set up Stripe ↗';$('stripe').disabled=posting||!hasOwner||!prepared||data.busy;
  $('worker-detail').textContent=running?'Your agent is watching for matching tasks. It resumes after login.':'Complete Stripe buying, model setup and selling payouts before starting.';
  $('start').textContent=running?'Stop selling':'Start selling';$('start').disabled=posting||data.busy||!hasOwner||(!running&&(!prepared||!paid||!buyReady));
  complete('google-number',hasOwner,1);complete('buyer-number',buyReady,2);complete('model-number',prepared,3);complete('stripe-number',paid,4);complete('worker-number',running,5);
  $('step-count').textContent=`${[hasOwner,buyReady,prepared,paid,running].filter(Boolean).length} of 5 ready`;
  $('phase').textContent=data.phase;$('progress-dot').classList.toggle('busy',data.busy);
  const loadedNames=new Set(m.loaded_models.map(x=>x.name));
  $('models').innerHTML=m.models.length?m.models.map(x=>`<tr><td>${escape(x.name)}<div class="model-sub">${escape(x.quantization||'Local model')}</div></td><td>${escape(x.parameters||'—')}</td><td>${gb(x.size)}</td><td><span class="tag ${loadedNames.has(x.name)?'loaded':!data.allowed_models.includes(x.name)?'ineligible':''}">${loadedNames.has(x.name)?'Loaded in memory':data.allowed_models.includes(x.name)?'Ready to prepare':'Not supported yet'}</span></td></tr>`).join(''):'<tr><td colspan="4" class="empty">No models installed yet. Prepare model downloads Qwen3 8B for you.</td></tr>';
  $('loaded').textContent=m.loaded_models.length?m.loaded_models.map(x=>`${x.name}: ${gb(x.size_vram)} reported GPU memory`).join(' · '):'No model is currently loaded in memory. Models load when work starts.';
  $('identity').textContent=data.seller_id?`Seller ${data.seller_id} · Identity linked in InsForge`:'';
  if(data.error)error(data.error);
 } catch(e){error(e.message);}
}
async function act(fn){posting=true;error(null);await refresh();try{await fn();}catch(e){error(e.message);}finally{posting=false;await refresh();}}
$('google').onclick=()=>act(async()=>{const r=await post('/api/auth/google');window.location.assign(r.url);});
$('prepare').onclick=()=>act(()=>post('/api/prepare'));
$('stripe').onclick=()=>{
 const popup=window.open('about:blank','atm-stripe');
 return act(async()=>{
 try{const r=await post('/api/payout');if(r.payout_onboarding_url){if(popup){popup.opener=null;popup.location=r.payout_onboarding_url;}else window.location.assign(r.payout_onboarding_url);}else{popup?.close();if(r.payout_status!=='ACTIVE')throw Error('Stripe setup is unavailable. Please try again.');}}
 catch(e){popup?.close();throw e;}
});};
$('start').onclick=()=>act(()=>post(data?.worker?.service==='running'?'/api/stop':'/api/start'));
refresh();setInterval(()=>refresh(),5000);
let chatSending=false, chatRefreshing=false, chatSnapshot='';
function refreshAccount() {
 const linked=Boolean(data?.owner && data?.buyer_id), payment=data?.buyer_payment;
 const ready=['READY','MOCK'].includes(payment?.buyer_payment_status);
 $('buyer-payment').disabled=!linked||posting;
 $('buyer-payment').textContent=ready?'Buying connected':'Set up buying ↗';
 $('buyer-detail').textContent=ready?'Stripe buying is connected. Your payment method is saved with Stripe.':!linked?'Connect your Google account first, then complete Stripe buying.':'Required: complete Stripe’s hosted buying setup to unlock requests and new seller starts.';
 $('buyer-status').textContent=!linked?'Sign in with Google to use one account for buying and selling.':`${data.owner.email} · ${ready?'Payment ready': 'Payment setup needed for network tasks'} · ${data.provider_budget?.remaining_microusd != null ? '$'+(data.provider_budget.remaining_microusd/1e6).toFixed(3)+' shared provider allowance remaining' : 'Shared allowance awaiting confirmation'}`;
 const models=data?.machine?.models??[], select=$('chat-model'), previous=select.value;
 const names=models.map(x=>x.name);
 if(JSON.stringify(names)!==select.dataset.models){select.replaceChildren(...names.map(name=>new Option(name,name)));select.dataset.models=JSON.stringify(names);if(names.includes(previous))select.value=previous;}
 $('chat-send').disabled=!linked||!ready||!names.length||chatSending;
 $('chat-notice').textContent=!linked?(data?.owner?'Your seller login needs one upgrade. Select Enable chat with Google below; your worker can keep running.':'Continue with Google below to start.'):!names.length?'Prepare a local model below before chatting.':!ready?'Complete required Stripe buying setup below to unlock Send request.':'Your agent can request network help within the account’s existing spending limits.';
}
const originalRefresh=refresh;
refresh=async()=>{await originalRefresh();refreshAccount();await refreshChats();};
async function chatPost(route,body){const r=await fetch(route,{method:'POST',headers:{'X-ATM-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(typeof j.error==='string'?j.error:j.error?.message||'The request could not finish.');return j;}
function bubble(section,label,value,kind){const item=document.createElement('div');item.className=`chat-bubble ${kind}`;const heading=document.createElement('strong');heading.textContent=label;const body=document.createElement('pre');body.textContent=value;item.append(heading,body);section.append(item);}
function eventDetails(section,label,value){if(value==null)return;const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent=label;body.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);details.append(summary,body);section.append(details);}
function toolLabel(name){return ({mcp_marketplace_info:'Checking marketplace options',mcp_whoami:'Checking account limits',mcp_list_sellers:'Looking for available workers',mcp_create_job:'Creating a shared job',mcp_post_task:'Posting a task for the network',mcp_get_task:'Checking task progress',mcp_get_result:'Reading task results',mcp_get_job:'Checking the shared job',wait:'Waiting for workers'})[name]??String(name??'Agent action').replaceAll('_',' ');}
async function refreshChats(){
 if(chatRefreshing||!data?.buyer_id)return;chatRefreshing=true;
 try{const r=await fetch('/api/chat');if(!r.ok)return;const j=await r.json();const snapshot=JSON.stringify(j.runs);if(snapshot===chatSnapshot)return;chatSnapshot=snapshot;
 const fragment=document.createDocumentFragment();
 for(const run of [...(j.runs??[])].reverse()){
  const section=document.createElement('section');section.className='chat-run';
  const title=document.createElement('h3');title.textContent=`Request ${run.id} · ${run.status}`;section.append(title);
  if(!['complete','completed','done','failed','error','stopped','cancelled','finished','interrupted'].includes(String(run.status).toLowerCase())){const stop=document.createElement('button');stop.textContent='Stop agent';stop.className='secondary';stop.onclick=async()=>{try{stop.disabled=true;await chatPost('/api/chat/stop',{id:run.id});await refreshChats();}catch(e){error(e.message);stop.disabled=false;}};title.append(stop);}
  if(run.prompt) bubble(section,'You',run.prompt,'user');
  for(const event of run.events??[]){
   if(event.type==='model'){
    if(event.message?.content)bubble(section,'Your agent',event.message.content,'assistant');
    if(event.message?.tool_calls?.length)eventDetails(section,'Requested tools',event.message.tool_calls);
   }else if(event.type==='task_status'){
    const task=event.task??{};const item=document.createElement('div');item.className='chat-event';
    const label=document.createElement('strong');label.textContent=`${task.status??'Status unavailable'} · ${task.task_id??'Task'}`;
    const note=document.createElement('p');note.textContent=task.seller_id?`Worker: ${task.seller_id}${task.model_id?' · '+task.model_id:''}`:'No worker assigned yet.';item.append(label,note);section.append(item);
   }else if(event.type==='tool_call'){
    const item=document.createElement('p');item.className='tool-action';item.textContent=toolLabel(event.name);section.append(item);eventDetails(section,'Request details',event.arguments);
   }else if(event.type==='tool_result'){eventDetails(section,`Result · ${toolLabel(event.name)}`,event.result);
   }else if(event.type==='stopped'){const note=document.createElement('p');note.className='tool-action';note.textContent=event.reason==='model_finished'?'Agent finished its response.':'Agent stopped: '+String(event.reason??run.status).replaceAll('_',' ');section.append(note);
   }else{eventDetails(section,'Activity details',event);}
  }
  for(const id of run.task_ids??[]){const task=document.createElement('span');task.className='chat-task';task.textContent=`Marketplace task: ${id}`;section.append(task);}
  if(run.error){const p=document.createElement('p');p.textContent=run.error;section.append(p);}fragment.append(section);
 }
 if(j.runs?.length)$('chat-runs').replaceChildren(fragment);
 }catch{ /* Keep the previous timeline during temporary polling failures. */ }finally{chatRefreshing=false;}
}
$('chat-form').onsubmit=async event=>{event.preventDefault();if(chatSending)return;chatSending=true;refreshAccount();error(null);try{await chatPost('/api/chat',{prompt:$('chat-prompt').value,model:$('chat-model').value});$('chat-prompt').value='';await refreshChats();}catch(e){error(e.message);}finally{chatSending=false;refreshAccount();}};
$('buyer-payment').onclick=()=>{const popup=window.open('about:blank','atm-buyer-payment');return act(async()=>{try{const r=await post('/api/buyer-payment');if(r.setup_url){if(popup){popup.opener=null;popup.location=r.setup_url;}else window.location.assign(r.setup_url);}else{popup?.close();if(!['READY','MOCK'].includes(r.buyer_payment_status))throw Error('Payment setup is unavailable. Please try again.');}}catch(e){popup?.close();throw e;}});};
setInterval(()=>{refreshAccount();void refreshChats();},3000);
