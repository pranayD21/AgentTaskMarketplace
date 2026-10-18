import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient, normalizeEndpoint, readIdentity } from '../../../scripts/buyer.mjs';
import { reserve, settle, writeAtomic } from '../../../scripts/benchmarks/budget.mjs';

const Input = z.object({
  prompt: z.string().trim().min(1).max(20000), context: z.string().max(60000).default(''),
  allowed_models: z.array(z.string().min(1)).min(1).max(20),
  price_cents: z.number().int().min(1).max(100000),
  max_runtime_s: z.number().int().min(1).max(1800).optional(),
  expires_in_s: z.number().int().min(1).max(86400),
  max_tokens: z.number().int().min(1).max(4096),
  rubric: z.object({kind: z.literal('contains_text'), expected_text: z.string().trim().min(1).max(1000)}).strict(),
}).strict();
const idPattern = /^web-[a-f0-9-]{36}$/;
const taskPattern = /^task_[a-zA-Z0-9_-]+$/;
class LocalError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new LocalError(code, message); };
const taskView = t => ({task_id:t.task_id, status:t.status, buyer_id:t.buyer_id, allowed_models:t.allowed_models,
  price_cents:t.price_cents ?? t.max_price_cents, seller_id:t.seller_id, model_id:t.model_id,
  created_at:t.created_at, expires_at:t.expires_at, review:t.review, replacement_status:t.replacement_status,
  payment_state:t.payment?.state});

/** Local development/preview only. Keys stay in the Node process; no registration or cap changes. */
export function createBuyerBridge({endpoint, statePath, journalDir, budgetPath, policyPath, clientFactory = createClient, humanAccount = false, getSession}) {
  endpoint = normalizeEndpoint(endpoint);
  const csrf = randomBytes(32).toString('hex');
  let mutation = false;
  function policy(buyer, recovering = false) {
    if (humanAccount) return Boolean(buyer?.owner?.user_id && buyer.provider_budget?.enforced &&
      (recovering || buyer.provider_budget.available) && ['READY','MOCK'].includes(buyer.buyer_payment?.buyer_payment_status));
    try {
      const p = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      return p.endpoint === endpoint && p.judge_model === 'claude-opus-5-5' && p.max_attempts === 3 &&
        p.submissions_enabled === true && Date.parse(p.valid_until) > Date.now();
    } catch { return false; }
  }
  function load(id, buyer) {
    if (!idPattern.test(id ?? '')) fail('INVALID_DRAFT', 'Choose a saved draft.');
    const draft = JSON.parse(fs.readFileSync(path.join(journalDir, `${id}.json`), 'utf8'));
    if (draft.id !== id || draft.endpoint !== endpoint || draft.buyer_id !== buyer.agent_id)
      fail('IDENTITY_MISMATCH', 'This draft belongs to another account or marketplace.');
    return draft;
  }
  const save = draft => writeAtomic(path.join(journalDir, `${draft.id}.json`), draft);
  const summary = d => ({id:d.id, state:d.state, task_id:d.task_id ?? null, price_cents:d.input.price_cents, created_at:d.created_at});
  function drafts(buyer) {
    if (!fs.existsSync(journalDir)) return [];
    return fs.readdirSync(journalDir).filter(f => idPattern.test(f.replace(/\.json$/, '')) && f.endsWith('.json'))
      // Skip drafts saved for another account or marketplace instead of failing the whole listing.
      .map(f => JSON.parse(fs.readFileSync(path.join(journalDir, f), 'utf8')))
      .filter(d => d.endpoint === endpoint && d.buyer_id === buyer.agent_id).map(summary).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  }
  async function connect() {
    const identity = readIdentity(statePath, endpoint);
    if (!identity) fail('BUYER_NOT_CONFIGURED', 'The local server needs an existing buyer account. No new account was created.');
    const client = clientFactory(endpoint, identity.api_key);
    await client.initialize();
    const buyer = await client.tool('whoami');
    if (buyer.kind !== 'buyer' || (identity.agent_id && identity.agent_id !== buyer.agent_id))
      fail('IDENTITY_MISMATCH', 'The saved identity is not the expected buyer.');
    if (humanAccount) {
      const session = await getSession?.();
      const owner = session?.owner?.user_id ?? session?.user_id;
      if (!owner || identity.owner?.user_id !== owner || buyer.owner?.user_id !== owner)
        fail('IDENTITY_MISMATCH', 'Sign in with the Google account that owns this buyer.');
    }
    return {client, buyer};
  }
  function validate(input, info, buyer) {
    const parsed = Input.safeParse(input);
    if (!parsed.success) fail('INVALID_SPECIFICATIONS', 'Complete the task, model, grading and numeric requirements.');
    const data = parsed.data;
    if (Buffer.byteLength(JSON.stringify({prompt:data.prompt,context:data.context,rubric:data.rubric}), 'utf8') > 2500)
      fail('INPUT_TOO_LONG', 'For this bounded test, keep the task, context and grading text under 2,500 UTF-8 bytes combined.');
    if (info.pricing?.mode !== 'task_offer' || !['card','mock'].includes(info.payments?.mode))
      fail('UNSUPPORTED_MODE', 'This tester requires posted offers with card TEST or MOCK payments.');
    if (data.allowed_models.some(m => !info.models.some(v => v.model_id === m)))
      fail('MODEL_NOT_ALLOWED', 'Choose a model advertised by this marketplace.');
    if (data.price_cents < info.payments.min_cents || data.price_cents > info.payments.max_cents)
      fail('INVALID_PRICE', 'The posted price must fit the marketplace minimum and maximum.');
    if (data.price_cents > buyer.spend.available_cents)
      fail('SPEND_CAP_EXCEEDED', 'The offer exceeds this buyer’s available test balance. Lower it or wait for a hold to be released.');
    return data;
  }
  function releaseZero(draft, result) {
    if (humanAccount) return;
    // Only a deterministic approval establishes no replacement API calls. Unknown/rejected stays reserved.
    const noModelCalls = (result.task.status === 'APPROVED' && result.verdict?.reason_code === 'RUBRIC_MATCH') ||
      (['CANCELLED','EXPIRED'].includes(result.task.status) && !result.result && !result.verdict);
    if (draft.reserved && noModelCalls) {
      const ledger = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
      if (ledger.entries[draft.id]?.state === 'reserved') settle(budgetPath, draft.id, 0);
      draft.reserved = false; save(draft);
    }
  }
  async function action(body) {
    const {client, buyer} = await connect();
    if (body.action === 'state') {
      const [info, listed, tasks] = await Promise.all([client.tool('marketplace_info'),client.tool('list_sellers'),client.tool('list_my_tasks')]);
      return {buyer:{agent_id:buyer.agent_id,display_name:buyer.display_name,spend:buyer.spend}, endpoint,
        models:info.models.map(m => ({model_id:m.model_id, family:m.family, params:m.params})),
        payments:{mode:info.payments.mode,min_cents:info.payments.min_cents,max_cents:info.payments.max_cents},
        submissions_enabled:policy(buyer), buyer_payment:buyer.buyer_payment, provider_budget:buyer.provider_budget, drafts:drafts(buyer), tasks:tasks.tasks.map(taskView),
        sellers:listed.sellers.map(s => ({seller_id:s.seller_id,display_name:s.display_name,status:s.status,
          models:s.models.map(m=>m.model_id),runtime:s.runner?.runtime,last_seen:s.last_seen}))};
    }
    if (body.action === 'prepare') {
      const input = validate(body.input, await client.tool('marketplace_info'), buyer);
      const draft = {id:`web-${randomUUID()}`,endpoint,buyer_id:buyer.agent_id,state:'DRAFT',created_at:new Date().toISOString(),input};
      save(draft);
      return {draft:{...summary(draft),input}};
    }
    if (body.action === 'draft') {
      const draft = load(body.id,buyer);
      return {draft:{...summary(draft),input:draft.input}};
    }
    if (body.action === 'discard') {
      const draft=load(body.id,buyer);
      const ledger=!humanAccount && fs.existsSync(budgetPath)?JSON.parse(fs.readFileSync(budgetPath,'utf8')):null;
      if(draft.state!=='DRAFT' || draft.task_id || ledger?.entries?.[draft.id])
        fail('DRAFT_ALREADY_ATTEMPTED','Submitted or uncertain requests must be recovered, not discarded.');
      fs.unlinkSync(path.join(journalDir,`${draft.id}.json`));
      return {discarded:true};
    }
    if (body.action === 'submit') {
      const draft = load(body.id,buyer);
      if (draft.task_id) return {draft:summary(draft)};
      if (!policy(buyer, draft.state === 'POSTING')) fail('SUBMISSIONS_PAUSED', humanAccount ? 'Complete payment setup and wait for available shared provider allowance. Your draft is saved.' : 'Submissions are paused pending operator confirmation. Your draft is saved.');
      // Replays use exactly the persisted payload and request id. Never allocate another request after uncertainty.
      if (draft.state === 'DRAFT') {
        validate(draft.input, await client.tool('marketplace_info'), buyer);
        if (!humanAccount) {
        if (!fs.existsSync(budgetPath)) fail('BUDGET_NOT_CONFIGURED', 'The shared API budget ledger must be configured before testing.');
        const ledger = JSON.parse(fs.readFileSync(budgetPath,'utf8'));
        if (!ledger.entries[draft.id]) {
          try { reserve(budgetPath, draft.id, 2_200_000); }
          catch { fail('API_BUDGET_UNAVAILABLE', 'The shared $5 API allowance cannot cover another test. Existing unknown or rejected calls need reconciliation first. No task was posted.'); }
        }
        else if (ledger.entries[draft.id].state !== 'reserved') fail('BUDGET_RECONCILIATION', 'This draft needs API budget reconciliation before submitting.');
        draft.reserved = true;
        }
        draft.state = 'POSTING'; save(draft);
      }
      const response = await client.tool('post_task', {...draft.input,client_request_id:draft.id});
      if (!taskPattern.test(response.task_id ?? response.task?.task_id ?? ''))
        fail('POST_OUTCOME_UNKNOWN', 'Submission outcome is unknown. Recover this saved submission; do not create another.');
      draft.task_id = response.task_id ?? response.task.task_id;
      draft.state = 'POSTED'; save(draft);
      return {draft:summary(draft)};
    }
    if (['task','cancel'].includes(body.action)) {
      if (!taskPattern.test(body.task_id ?? '')) fail('INVALID_TASK','Choose a task from your account.');
      if (body.action === 'cancel') await client.tool('cancel_task',{task_id:body.task_id});
      const result = await client.tool('get_result',{task_id:body.task_id});
      for (const entry of drafts(buyer).filter(d => d.task_id === body.task_id)) releaseZero(load(entry.id,buyer),result);
      const approved = result.task.status === 'APPROVED' && result.result?.commitment_verified === true;
      const replacement = result.task.status === 'REJECTED' && result.replacement_status === 'DELIVERED';
      return {task:taskView(result.task),commitment_verified:result.result?.commitment_verified === true,
        answer:approved ? result.result.answer : null, replacement_answer:replacement ? result.replacement_answer : null,
        replacement_status:result.replacement_status,
        settlement:result.settlement ? {kind:result.settlement.kind,finalized_at:result.settlement.finalized_at,
          seller_payout_cents:result.settlement.seller_payout_cents,buyer_refund_cents:result.settlement.buyer_refund_cents,
          payout_transferred_cents:result.settlement.payout_transferred_cents,transfer_state:result.settlement.transfer_state} : null};
    }
    fail('UNKNOWN_ACTION','Unsupported buyer action.');
  }
  return async function middleware(req,res,next) {
    if (req.url?.split('?')[0] !== '/api/buyer') return next();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send = (status,value) => { res.statusCode=status; res.end(JSON.stringify(value)); };
    let ownLock = false;
    try {
      const host = req.headers.host;
      const address = req.socket.remoteAddress;
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address) ||
        !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host ?? '') ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        (req.headers['sec-fetch-site'] !== 'same-origin' && req.headers.origin !== `http://${host}`))
        fail('LOCAL_ONLY','Open the buyer tester on this computer using its local dashboard URL.');
      if (req.method === 'GET') return send(200,{token:csrf,endpoint});
      if (req.method !== 'POST' || req.headers['x-atm-csrf'] !== csrf || !req.headers['content-type']?.startsWith('application/json'))
        fail('SESSION_REQUIRED','Reconnect to the local buyer session.');
      let raw='';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw)>100000) fail('INPUT_TOO_LONG','Request is too large.'); }
      const body = JSON.parse(raw);
      if (['prepare','submit','task','cancel','discard'].includes(body.action)) {
        if (mutation) fail('REQUEST_IN_PROGRESS','A buyer operation is already running. Wait before retrying.');
        mutation=true; ownLock=true;
      }
      send(200,await action(body));
    } catch (error) {
      // Never send provider bodies, secrets, prompts or free-form remote errors to the browser/logs.
      const local = error instanceof LocalError;
      const code = local ? error.code : 'BUYER_REQUEST_FAILED';
      send(400,{error:{code,message:local ? error.message : 'The request did not finish. Refresh your account or recover the saved submission before posting again.'}});
    } finally { if (ownLock) mutation=false; }
  };
}
