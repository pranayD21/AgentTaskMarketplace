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
  const m=data.machine,w=data.worker,hasOwner=Boolean(data.owner),prepared=Boolean(w.prepared),paid=w.payout_status==='ACTIVE',running=w.service==='running';
  $('connection').textContent=m.ollama_online?'●  Connected to your Mac':'●  Ollama is offline';
  $('chip').textContent=m.chip; $('host').textContent=m.hostname; $('model-host').textContent=m.hostname;
  $('cores').textContent=m.cpu_cores; $('load').textContent=`1-minute load: ${Number(m.load_average_1m).toFixed(2)}`;
  $('memory').textContent=gb(m.memory_bytes);$('free').textContent=`${gb(m.free_memory_bytes)} free physical memory`;
  $('approvals').textContent=w.approvals??'—'; $('activity').textContent=running?'Worker running · approved tasks':'Worker stopped · approved tasks';
  $('ollama').textContent=m.ollama_online?'Ollama connected':'Ollama offline';
  $('google-detail').textContent=hasOwner?`Signed in as ${data.owner.email}`:'Create your human identity and link this seller to you.';
  $('google').textContent=hasOwner?'Sign in again':'Continue with Google ↗'; $('google').disabled=posting||data.busy||running;
  $('model-detail').textContent=prepared?'Local model passed its liveness check in the Wasm sandbox.':'Uses a supported installed model, or downloads Qwen3 8B (about 5.2 GB).';
  $('prepare').textContent=data.busy?'Preparing…':prepared?'Check model again':'Prepare model';$('prepare').disabled=posting||!hasOwner||data.busy||running;
  $('stripe-detail').textContent=paid?'Stripe test transfer capability is active. This does not confirm a real bank payout.':prepared?'Complete Stripe’s hosted payout setup for this seller account.':'Prepare your model to create your Stripe payout account.';
  $('stripe').textContent=paid?'Check Stripe status':'Set up Stripe ↗';$('stripe').disabled=posting||!hasOwner||!prepared||data.busy;
  $('worker-detail').textContent=running?'Your agent is watching for matching tasks. It resumes after login.':'Start when your model and Stripe payout account are ready.';
  $('start').textContent=running?'Stop selling':'Start selling';$('start').disabled=posting||data.busy||!hasOwner||(!running&&(!prepared||!paid));
  complete('google-number',hasOwner,1);complete('model-number',prepared,2);complete('stripe-number',paid,3);complete('worker-number',running,4);
  $('step-count').textContent=`${[hasOwner,prepared,paid,running].filter(Boolean).length} of 4 ready`;
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
refresh();setInterval(refresh,5000);
