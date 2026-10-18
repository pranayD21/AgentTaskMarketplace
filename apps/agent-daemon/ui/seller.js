const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gb = bytes => `${(Number(bytes || 0)/1024**3).toFixed(1)} GB`;
let data, posting = false, accountInitialized=false;
const error = message => { $('error').textContent = message || ''; $('error').hidden = !message; };
const complete = (id, done, number) => { $(id).classList.toggle('done', done); $(id).textContent = done ? '✓' : number; };
async function post(route) {
 const r = await fetch(route,{method:'POST',headers:{'X-ATM-Request':'1'}}); const j = await r.json(); if(!r.ok) throw Error(j.error || 'Could not finish. Please try again.'); return j;
}
async function refresh() {
 try {
  const r=await fetch('/api/status'); if(!r.ok) throw Error('Open this dashboard again with atm-seller dashboard.'); data=await r.json();
  const m=data.machine,w=data.worker,hasOwner=Boolean(data.owner),prepared=Boolean(w.prepared),paid=w.payout_status==='ACTIVE',running=w.service==='running',buyReady=['READY','MOCK'].includes(data.buyer_payment?.buyer_payment_status);
  if(!accountInitialized){$('account-setup').open=!hasOwner||!buyReady;accountInitialized=true;}$('account-summary').textContent=hasOwner&&buyReady?'Connected · manage account':'Setup needed';
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
  $('seller-toggle').textContent=running?'Stop seller mode':'Activate seller mode';$('seller-toggle').disabled=$('start').disabled;$('seller-mode-detail').textContent=running?'Watching for tasks · one sandbox task at a time':'Set your allocation below, then activate to accept network work.';
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
let chatSending=false, chatRefreshing=false, chatSnapshot='', conversationId=localStorage.getItem('atm-conversation')||crypto.randomUUID();
function refreshAccount() {
 const linked=Boolean(data?.owner && data?.buyer_id), payment=data?.buyer_payment;
 const ready=['READY','MOCK'].includes(payment?.buyer_payment_status);
 $('buyer-payment').disabled=!linked||posting;$('buying-link').textContent=ready?'Manage account ↓':'Complete Stripe setup ↓';$('buying-link').onclick=()=>{$('account-setup').open=true;};
 $('buyer-payment').textContent=ready?'Buying connected':'Set up buying ↗';
 $('buyer-detail').textContent=ready?'Stripe buying is connected. Your payment method is saved with Stripe.':!linked?'Connect your Google account first, then complete Stripe buying.':'Required: complete Stripe’s hosted buying setup to unlock requests and new seller starts.';
 $('buyer-status').textContent=!linked?'Sign in with Google to use one account for buying and selling.':`${data.owner.email} · ${ready?'Payment ready': 'Payment setup needed for network tasks'} · ${data.provider_budget?.remaining_microusd != null ? '$'+(data.provider_budget.remaining_microusd/1e6).toFixed(3)+' shared provider allowance remaining' : 'Shared allowance awaiting confirmation'}`;
 const models=data?.machine?.models??[], select=$('chat-model'), previous=select.value;
 const names=models.map(m=>m.name);
 if(JSON.stringify(names)!==select.dataset.models){select.replaceChildren(...names.map(name=>new Option(name,name)));select.dataset.models=JSON.stringify(names);if(names.includes(previous))select.value=previous;else if(names.includes('qwen3:8b'))select.value='qwen3:8b';}
 $('chat-send').disabled=!linked||!ready||!names.length||chatSending;
 $('chat-notice').textContent=!linked?(data?.owner?'Your seller login needs one upgrade. Select Enable chat with Google below; your worker can keep running.':'Continue with Google below to start.'):!names.length?'Install a local Ollama model to chat.':!ready?'Complete required Stripe buying setup below to unlock Send request.':'Your model chooses whether to delegate. Network offers: 50–100 TEST cents each, at most 200 per request. Acceptance checks completion format, not answer correctness.';
}
const originalRefresh=refresh;
refresh=async()=>{await originalRefresh();refreshAccount();await refreshChats();};
async function chatPost(route,body){const r=await fetch(route,{method:'POST',headers:{'X-ATM-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(typeof j.error==='string'?j.error:j.error?.message||'The request could not finish.');return j;}
function bubble(section,label,value,kind){const item=document.createElement('div');item.className=`chat-bubble ${kind}`;const heading=document.createElement('strong');heading.textContent=label;const body=document.createElement('pre');body.textContent=value;item.append(heading,body);section.append(item);}
function eventDetails(section,label,value){if(value==null)return;const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent=label;body.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);details.append(summary,body);section.append(details);}
function toolLabel(name){return ({mcp_marketplace_info:'Checking marketplace options',mcp_whoami:'Checking account limits',mcp_list_sellers:'Looking for available workers',mcp_create_job:'Creating a shared job',mcp_post_task:'Posting a task for the network',mcp_get_task:'Checking task progress',mcp_get_result:'Reading task results',mcp_get_job:'Checking the shared job',wait:'Waiting for workers'})[name]??String(name??'Agent action').replaceAll('_',' ');}
async function refreshChats(){
 if(chatRefreshing||!data?.buyer_id)return;chatRefreshing=true;
 try{const r=await fetch('/api/chat');if(!r.ok)return;const j=await r.json();const ids=[...new Set([conversationId,...(j.runs??[]).map(r=>r.conversation_id||r.id)])]; $('conversation').replaceChildren(...ids.map(id=>{const first=(j.runs??[]).find(r=>(r.conversation_id||r.id)===id);return new Option(first?.prompt?.slice(0,60)||'New conversation',id);}));$('conversation').value=conversationId; const snapshot=conversationId+JSON.stringify(j.runs);if(snapshot===chatSnapshot)return;chatSnapshot=snapshot;
 const fragment=document.createDocumentFragment();
 for(const run of [...(j.runs??[])].filter(r=>(r.conversation_id||r.id)===conversationId).reverse()){
  const section=document.createElement('section');section.className='chat-run';
  const title=document.createElement('h3');title.textContent=`${run.status==='finished'?'✓ Completed':run.status==='failed'?'Needs attention':'In progress'} · ${run.task_ids?.length??0} task(s)`;section.append(title);
  if(['running','waiting'].includes(run.status)){const stop=document.createElement('button');stop.textContent='Stop waiting';stop.className='secondary';stop.onclick=async()=>{try{stop.disabled=true;await chatPost('/api/chat/stop',{id:run.id});await refreshChats();}catch(e){error(e.message);stop.disabled=false;}};title.append(stop);}
  if(typeof renderTaskCards==='function')renderTaskCards(section,run);
  if(run.prompt) bubble(section,'You',run.prompt,'user');
  for(const event of run.events??[]){
   if(event.type==='model'||event.type==='model_delta'){
    if(event.message?.thinking||event.thinking)eventDetails(section,event.type==='model_delta'?'Thinking…':'Model reasoning',event.message?.thinking||event.thinking);
    if(event.message?.content||event.content)bubble(section,'Your agent',event.message?.content||event.content,'assistant');
    if(event.message?.tool_calls?.length)eventDetails(section,'Requested tools',event.message.tool_calls);
   }else if(event.type==='remote_answer'||event.type==='remote_preview'){
    // Outputs are presented once in the task cards above the activity history.
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
 $('chat-runs').replaceChildren(fragment);if(!$('chat-runs').children.length)$('chat-runs').textContent='Start a conversation. Your model’s work and delegated tasks will appear here.';
 }catch{ /* Keep the previous timeline during temporary polling failures. */ }finally{chatRefreshing=false;}
}
$('chat-form').onsubmit=async event=>{event.preventDefault();if(chatSending)return;chatSending=true;refreshAccount();error(null);try{await chatPost('/api/chat',{prompt:$('chat-prompt').value,model:$('chat-model').value,conversation_id:conversationId});$('chat-prompt').value='';await refreshChats();}catch(e){error(e.message);}finally{chatSending=false;refreshAccount();}};
$('buyer-payment').onclick=()=>{const popup=window.open('about:blank','atm-buyer-payment');return act(async()=>{try{const r=await post('/api/buyer-payment');if(r.setup_url){if(popup){popup.opener=null;popup.location=r.setup_url;}else window.location.assign(r.setup_url);}else{popup?.close();if(!['READY','MOCK'].includes(r.buyer_payment_status))throw Error('Payment setup is unavailable. Please try again.');}}catch(e){popup?.close();throw e;}});};
setInterval(()=>{refreshAccount();void refreshChats();},3000);

function selectConversation(id){conversationId=id;localStorage.setItem('atm-conversation',id);chatSnapshot='';void refreshChats();}
$('new-chat').onclick=()=>{selectConversation(crypto.randomUUID());$('chat-prompt').focus();};
$('conversation').onchange=()=>selectConversation($('conversation').value);
function selectTab(name){$('workspace-title').textContent=name==='buyer'?'What would you like to get done?':'Your compute, at work.';for(const id of ['buyer','seller']){$(id+'-panel').hidden=id!==name;$(id+'-tab').classList.toggle('active',id===name);$(id+'-tab').setAttribute('aria-selected',String(id===name));}localStorage.setItem('atm-tab',name);}
for(const name of ['buyer','seller'])$(name+'-tab').onclick=()=>selectTab(name);
selectTab(localStorage.getItem('atm-tab')==='seller'?'seller':'buyer');
let computeLoaded=false;
async function refreshCompute(){
 if(!data)return;
 const running=data.worker?.service==='running';
 if(!computeLoaded){const r=await fetch('/api/compute');if(r.ok){const c=await r.json();$('compute-threads').value=c.cpu_threads;$('compute-context').value=c.context_tokens;$('compute-memory').value=c.max_model_gb;$('compute-threads').max=data.machine.cpu_cores;const names=(data.machine.models??[]).filter(m=>data.allowed_models.includes(m.name)).map(m=>m.name);$('compute-model').replaceChildren(new Option('All supported models',''),...names.map(n=>new Option(n,n)));$('compute-model').value=c.model||'';computeLoaded=true;}}
 for(const id of ['compute-model','compute-threads','compute-context','compute-memory','compute-save'])$(id).disabled=running||posting;
 $('compute-note').textContent=running?'Stop selling before changing allocation. Your current task will otherwise be interrupted.':'Allocation is saved locally on this computer.';
 const url=data.worker?.viewer_url;
 if(url&&/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+\/?$/.test(url)&&running){$('seller-viewer').hidden=false;$('viewer-empty').hidden=true;$('viewer-link').hidden=false;$('viewer-link').href=url;if($('seller-viewer').src!==new URL(url).href)$('seller-viewer').src=url;}else{$('seller-viewer').hidden=true;$('viewer-empty').hidden=false;$('viewer-link').hidden=true;}
}
$('compute-form').onsubmit=event=>{event.preventDefault();void act(async()=>{await chatPost('/api/compute',{cpu_threads:Number($('compute-threads').value),context_tokens:Number($('compute-context').value),max_model_gb:Number($('compute-memory').value),model:$('compute-model').value});computeLoaded=false;await refreshCompute();});};
setInterval(()=>void refreshCompute(),3000);

$('seller-toggle').onclick=()=>act(()=>post(data?.worker?.service==='running'?'/api/stop':'/api/start'));

for(const name of ['buyer','seller'])$(name+'-tab').onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'buyer':event.key==='End'?'seller':name==='buyer'?'seller':'buyer';selectTab(next);$(next+'-tab').focus();}};
