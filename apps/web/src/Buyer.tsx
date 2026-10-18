import { useEffect, useRef, useState, type FormEvent } from 'react';
import { money, time } from './data';

type Task = {task_id:string;status:string;price_cents:number;seller_id:string|null;model_id:string|null;created_at:string;
  payment_state:string;review?:{status:string;attempts:number};replacement_status?:string};
type Spec = {prompt:string;context:string;allowed_models:string[];price_cents:number;max_runtime_s:number;expires_in_s:number;
  max_tokens:number;rubric:{kind:'contains_text';expected_text:string}};
type Draft = {id:string;state:string;task_id:string|null;price_cents:number;created_at:string;input?:Spec};
type Account = {endpoint:string;submissions_enabled:boolean;
  buyer:{agent_id:string;display_name:string;spend:{cap_cents:number;available_cents:number;spent_cents:number;reserved_cents:number}};
  payments:{mode:string;min_cents:number;max_cents:number}; models:{model_id:string}[];drafts:Draft[];tasks:Task[];
  sellers:{seller_id:string;display_name:string;status:string;models:string[];runtime:string;last_seen:string}[]};
type Detail = {task:Task;answer:string|null;replacement_answer:string|null;commitment_verified:boolean;replacement_status:string;
  settlement:null|{kind:string;finalized_at:string|null;seller_payout_cents:number;buyer_refund_cents:number;payout_transferred_cents:number;transfer_state:string}};
const terminal = ['APPROVED','REJECTED','CANCELLED','EXPIRED'];

export function Buyer() {
  const token = useRef('');
  const pending = useRef(false);
  const [account,setAccount] = useState<Account>();
  const [models,setModels] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [draft,setDraft] = useState<Draft>();
  const [detail,setDetail] = useState<Detail>();
  const [showAnswer,setShowAnswer] = useState(false);
  const [polling,setPolling] = useState(false);
  const [notice,setNotice] = useState('');
  async function call<T>(action:string, args:Record<string,unknown> = {}):Promise<T> {
    if (!token.current) {
      const response = await fetch('/api/buyer',{credentials:'same-origin',cache:'no-store',redirect:'error'});
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
        throw new Error('The buyer tester needs this computer’s local web server. The hosted public board does not have access to your account.');
      token.current = (await response.json()).token;
    }
    const response = await fetch('/api/buyer',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'content-type':'application/json','x-atm-csrf':token.current},body:JSON.stringify({action,...args}),signal:AbortSignal.timeout(120000)});
    const result = await response.json();
    if (!response.ok) {
      if (result.error?.code === 'SESSION_REQUIRED') token.current='';
      throw new Error(result.error?.message ?? 'Request did not finish. Recover the saved submission before trying a new task.');
    }
    return result;
  }
  async function refresh() {
    const next = await call<Account>('state'); setAccount(next); return next;
  }
  async function run(fn:()=>Promise<void>) {
    if (pending.current) return;
    pending.current=true;setBusy(true);setError('');setNotice('');
    try { await fn(); } catch(e) {setError(e instanceof Error ? e.message : 'Request failed. Refresh your account before continuing.');}
    finally {pending.current=false;setBusy(false);}
  }
  async function connect() {
    await run(async()=>{const next=await refresh();setModels(next.models.some(m=>m.model_id==='qwen3:8b')?['qwen3:8b']:next.models.slice(0,1).map(m=>m.model_id));});
  }
  function review(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input:Spec = {prompt:String(fields.get('prompt')),context:String(fields.get('context')),
      allowed_models:models,price_cents:Number(fields.get('price')),max_runtime_s:Number(fields.get('runtime')),
      expires_in_s:Number(fields.get('expires')),max_tokens:Number(fields.get('tokens')),
      rubric:{kind:'contains_text',expected_text:String(fields.get('expected'))}};
    void run(async()=>{const result=await call<{draft:Draft}>('prepare',{input});setDraft(result.draft);await refresh();});
  }
  async function selectTask(id:string) {
    setShowAnswer(false);setPolling(false);
    const result=await call<Detail>('task',{task_id:id});setDetail(result);
    setPolling(!terminal.includes(result.task.status));
  }
  useEffect(()=>{
    if (!polling || !detail) return;
    let stopped=false;
    const start=Date.now();
    let timer:ReturnType<typeof setTimeout>;
    const id=detail.task.task_id;
    async function poll() {
      if (pending.current) {timer=setTimeout(poll,3000);return;}
      try {
        const result=await call<Detail>('task',{task_id:id});
        if (stopped) return;
        setDetail(result);
        if (terminal.includes(result.task.status)) {setPolling(false);await refresh();return;}
        if (Date.now()-start>=300000) {setPolling(false);setNotice('Automatic tracking paused after five minutes. Refresh the task to continue.');return;}
        timer=setTimeout(poll,3000);
      } catch {if (!stopped) {setPolling(false);setError('Tracking paused after a connection error. Refresh this task; do not submit it again.');}}
    }
    timer=setTimeout(poll,3000);
    return ()=>{stopped=true;clearTimeout(timer);};
  // The timer belongs to the selected task; polling updates must not reset its five-minute limit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[polling,detail?.task.task_id]);
  const potential = account?.sellers.filter(s=>s.status==='ACTIVE' && s.models.some(m=>models.includes(m))) ?? [];
  const canSubmit = account?.submissions_enabled && !busy;
  return <section id="buyer" className="panel buyer-panel" aria-labelledby="buyer-title">
    <div className="section-title"><h2 id="buyer-title"><span>BUY</span>Submit a task</h2><p>Human testing workspace · existing buyer account</p></div>
    <div className="buyer-body">
      {!account ? <div className="buyer-welcome"><div><h3>What would you like done?</h3><p>Describe the work, choose compatible models, and set an offer. A seller claims your task, then a judge checks the result.</p><small>Your account key stays on this computer. Payments use Stripe TEST or MOCK mode.</small></div>
        <button className="primary-button" disabled={busy} onClick={()=>void connect()}>{busy?'Connecting…':'Use local buyer account →'}</button></div> : <>
        <div className="buyer-account"><div><span className="tiny-label">CONNECTED BUYER</span><strong>{account.buyer.display_name}</strong><code>{account.buyer.agent_id}</code></div>
          <div><span>Available</span><strong>{money(account.buyer.spend.available_cents)}</strong><small>{account.payments.mode==='mock'?'MOCK':'Stripe TEST'} · cap {money(account.buyer.spend.cap_cents)}</small></div>
          <div><span>Reserved / spent</span><strong>{money(account.buyer.spend.reserved_cents)} / {money(account.buyer.spend.spent_cents)}</strong><button disabled={busy} onClick={()=>void run(async()=>{await refresh();})}>Refresh account</button></div>
        </div>
        {!account.submissions_enabled && <p className="buyer-notice" role="status">Submissions are temporarily paused pending confirmation of the shared judge’s settings and test allowance. You can prepare and review a task now.</p>}
        <div className="buyer-columns">
          <form onSubmit={review} className="buyer-form">
            <div className="buyer-step"><span>01</span><h3>Describe the work</h3></div>
            <label>Task instructions<textarea name="prompt" required rows={5} maxLength={20000} placeholder="Describe the goal, required output format, and any constraints…" /></label>
            <label>Supporting context <span className="muted">(optional)</span><textarea name="context" rows={3} maxLength={60000} placeholder="Add source data, examples, or other details the seller will need." /></label>
            <small>Task, context and grading text: up to 2,500 UTF-8 bytes combined for this bounded test.</small>
            <div className="buyer-step"><span>02</span><h3>Set specifications</h3></div>
            <fieldset><legend>Allowed models · choose at least one</legend><div className="model-options">{account.models.map(m=><label key={m.model_id}><input type="checkbox" checked={models.includes(m.model_id)} onChange={e=>setModels(old=>e.target.checked?[...old,m.model_id]:old.filter(v=>v!==m.model_id))}/>{m.model_id}</label>)}</div></fieldset>
            <div className="buyer-fields"><label>Posted offer (test cents)<input type="number" name="price" min={account.payments.min_cents} max={Math.min(account.payments.max_cents,account.buyer.spend.available_cents)} defaultValue={100} required /></label>
              <label>Maximum output tokens<input type="number" name="tokens" min={1} max={4096} defaultValue={512} required /></label>
              <label>Seller runtime limit<select name="runtime" defaultValue="180"><option value="60">1 minute</option><option value="180">3 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option></select></label>
              <label>Listing expires after<select name="expires" defaultValue="3600"><option value="900">15 minutes</option><option value="3600">1 hour</option><option value="21600">6 hours</option><option value="86400">24 hours</option></select></label></div>
            <label>Expected text in the result<input name="expected" required maxLength={1000} placeholder="A phrase or value the answer must contain" /></label>
            <small>The judge checks this text case-insensitively. Put format and quality requirements in your task instructions too. This check alone does not establish factual accuracy.</small>
            <p className="buyer-privacy">Your instructions and answer stay off the public board. The marketplace and judge can read them; the seller’s machine owner can inspect inference. This is a Wasm sandbox, not a confidential VM.</p>
            <button className="primary-button" disabled={busy || !models.length} type="submit">{busy?'Working…':'Review task →'}</button>
          </form>
          <aside className="buyer-matches" aria-label="Potential sellers"><span className="tiny-label">POTENTIAL SELLERS</span><h3>{potential.length} compatible {potential.length===1?'seller':'sellers'}</h3>
            <p>These active registrations advertise a selected model. Availability is not guaranteed. The first eligible seller to claim your offer gets the task.</p>
            {potential.length ? potential.map(s=><div className="buyer-match" key={s.seller_id}><strong>{s.display_name}</strong><code>{s.seller_id}</code><span>{s.models.filter(m=>models.includes(m)).join(', ')}</span><small>{s.runtime==='node-unsandboxed'?'UNSANDBOXED':s.runtime} · last seen {time(s.last_seen)}</small></div>) : <p>No compatible sellers are listed. Choose another model or wait for a seller to join.</p>}
            <p className="muted">You set the task price. Sellers accept it by claiming; they do not negotiate a separate price here.</p>
          </aside>
        </div>
        {draft && <article className="buyer-review" aria-label="Review task"><div className="buyer-step"><span>03</span><h3>{draft.state==='DRAFT'?'Review before submitting':'Saved submission'}</h3></div>
          <p><strong>{money(draft.price_cents)} {account.payments.mode==='mock'?'MOCK':'Stripe TEST'} offer</strong> · {draft.input?.allowed_models.join(', ')}</p>
          {draft.input && <><pre className="private-text">{draft.input.prompt}</pre>{draft.input.context && <details><summary>Supporting context</summary><pre className="private-text">{draft.input.context}</pre></details>}
            <p>Expected text: <strong>{draft.input.rubric.expected_text}</strong> · output ≤ {draft.input.max_tokens} tokens · runtime ≤ {draft.input.max_runtime_s}s · listing {draft.input.expires_in_s/60} min</p></>}
          <small>Submitting reserves the posted offer against your existing cap. Possible judge replacement calls reserve $2.20 of the shared $5 API budget; that is a spending allowance, not a charge. Deterministic approval releases it.</small>
          <div className="buyer-actions"><button className="primary-button" disabled={!canSubmit || !!draft.task_id} onClick={()=>void run(async()=>{
            const result=await call<{draft:Draft}>('submit',{id:draft.id});setDraft({...draft,...result.draft});
            if(result.draft.task_id) await selectTask(result.draft.task_id);await refresh();
          })}>{draft.state==='DRAFT'?`Submit for ${money(draft.price_cents)} test`:'Recover same submission'}</button>
          <button disabled={busy} onClick={()=>setDraft(undefined)}>Close review</button></div>
          <small>Saved request <code>{draft.id}</code>. Recovery uses this same request; it never creates a new purchase ID.</small>
        </article>}
        {account.drafts.some(d=>!d.task_id) && <div className="buyer-saved"><h3>Saved drafts & unresolved submissions</h3>{account.drafts.filter(d=>!d.task_id).map(d=><div className="buyer-saved-row" key={d.id}><code>{d.id}</code><span>{d.state} · {money(d.price_cents)}</span><button disabled={busy} onClick={()=>void run(async()=>{setDraft((await call<{draft:Draft}>('draft',{id:d.id})).draft);})}>Open / recover</button>{d.state==='DRAFT' && <button disabled={busy} onClick={()=>void run(async()=>{await call('discard',{id:d.id});if(draft?.id===d.id)setDraft(undefined);await refresh();})}>Discard draft</button>}</div>)}</div>}
        <div className="buyer-history"><h3>Your tasks</h3>{account.tasks.length ? <div className="table-scroll"><table><thead><tr><th>Task</th><th>Status</th><th>Offer</th><th>Seller</th><th /></tr></thead><tbody>{account.tasks.map(t=><tr key={t.task_id}><td><code>{t.task_id}</code></td><td>{t.status}</td><td>{money(t.price_cents)}</td><td><code>{t.seller_id ?? 'Awaiting claim'}</code></td><td><button disabled={busy} onClick={()=>void run(()=>selectTask(t.task_id))}>Track / result</button></td></tr>)}</tbody></table></div>:<p>No tasks on this buyer account yet.</p>}</div>
        {detail && <article className="buyer-result"><h3>Your result</h3><code>{detail.task.task_id}</code><p><strong>{detail.task.status}</strong> · {detail.task.payment_state} · {polling?'tracking every 3 seconds':'tracking paused / finished'}</p>
          <ol className="buyer-progress">{['Posted','Seller working','Judge reviewing','Result'].map((label,index)=>{
            const step=terminal.includes(detail.task.status)?3:['SUBMITTED','JUDGING'].includes(detail.task.status)?2:['CLAIMED','PAYLOAD_READY','RUNNING'].includes(detail.task.status)?1:0;
            return <li className={index<=step?'reached':''} key={label}>{label}</li>;
          })}</ol>
          <p>Seller: <code>{detail.task.seller_id ?? 'Waiting for an eligible seller'}</code>{detail.task.model_id && ` · ${detail.task.model_id}`}</p>
          {detail.task.review && <p>Review: {detail.task.review.status} · {detail.task.review.attempts} retries</p>}
          {detail.task.status==='APPROVED' && !detail.commitment_verified && <p role="alert">Commitment verification failed. The seller answer is withheld.</p>}
          {detail.task.status==='REJECTED' && <p>Seller result rejected. Judge replacement: {detail.replacement_status ?? 'Unavailable'}.</p>}
          {(detail.answer || detail.replacement_answer) ? <><button disabled={busy} onClick={()=>setShowAnswer(v=>!v)}>{showAnswer?'Hide private answer':'Reveal private answer'}</button>{showAnswer && <><p>{detail.replacement_answer?'Judge-produced replacement':'Judge approved · commitment verified'}</p><pre className="private-text">{detail.replacement_answer ?? detail.answer}</pre></>}</> : <p>No approved, verified answer is available yet.</p>}
          {detail.settlement && <p>{detail.settlement.kind} · seller owed {money(detail.settlement.seller_payout_cents)} · transferred {money(detail.settlement.payout_transferred_cents ?? 0)} · released {money(detail.settlement.buyer_refund_cents)} · {detail.settlement.finalized_at?'Buyer settlement finalized':'Settlement pending'}</p>}
          <div className="buyer-actions"><button disabled={busy} onClick={()=>void run(()=>selectTask(detail.task.task_id))}>Refresh task</button>
            {detail.task.status==='OPEN' && <button disabled={busy} onClick={()=>void run(async()=>{setPolling(false);setDetail(await call<Detail>('cancel',{task_id:detail.task.task_id}));await refresh();})}>Cancel unclaimed task</button>}
            <button disabled={busy} onClick={()=>{setDetail(undefined);setShowAnswer(false);setPolling(false);}}>Close private view</button></div>
        </article>}
      </>}
      {busy && <p role="status">Working with the marketplace…</p>}
      {notice && <p role="status" className="buyer-notice">{notice}</p>}
      {error && <p role="alert" className="buyer-error">{error}</p>}
    </div>
  </section>;
}
