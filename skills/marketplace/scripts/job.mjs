import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export class JobError extends Error {
  constructor(code, message, nextAction) { super(message); Object.assign(this, { code, nextAction, retryable: false }); }
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(message) { throw new JobError('JOB_INPUT_INVALID', message, 'Check the private job input and authorized budget; do not change an in-flight plan.'); }
function rubric(value) {
  if (value?.kind === 'contains_text' && typeof value.expected_text === 'string' && value.expected_text.trim()) return { kind: value.kind, expected_text: value.expected_text };
  if (value?.kind === 'llm_rubric' && typeof value.criteria === 'string' && value.criteria.trim()) return { kind: value.kind, criteria: value.criteria };
  invalid('Each job part needs an explicit grading rubric.');
}
export function taskOfferFields(offer, info) {
  if (info.pricing?.mode !== 'task_offer') throw new JobError('JOB_PRICING_NOT_READY', 'Marketplace has not enabled task-offer pricing.', 'Wait for the deployed task-offer contract; do not fall back to seller asks.');
  return { price_cents: offer };
}
export function planJob(input, { endpoint, parts = 2, budget, id = randomUUID() }) {
  if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 16000) invalid('Instruction must contain 1–16,000 characters.');
  if (!Array.isArray(input.records) || input.records.length < 2 || input.records.length > 100) invalid('Supply 2–100 independent records.');
  if (!Number.isInteger(parts) || parts < 2 || parts > 20 || parts > input.records.length) invalid('Use 2–20 nonempty independent parts.');
  if (!Number.isSafeInteger(budget) || budget < parts || budget > 100000) invalid('Job budget must be an integer from the part count to 100,000 cents.');
  const ids = input.records.map(record => record?.id);
  if (ids.some(recordId => typeof recordId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(recordId)) || new Set(ids).size !== ids.length) invalid('Record IDs must be unique safe identifiers.');
  const model = input.model ?? 'qwen3:8b';
  if (typeof model !== 'string' || !model.trim()) invalid('A model ID is required.');
  const maxTokens = input.max_tokens ?? 512;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) invalid('max_tokens must be 1–4096.');
  const planned = [];
  for (let index = 0; index < parts; index++) {
    const records = input.records.slice(Math.floor(index * ids.length / parts), Math.floor((index + 1) * ids.length / parts));
    const prompt = `${input.instruction}\n\nApply the instruction independently to each record in the supplied context. Return a JSON array with exactly one object per input record, with keys "id" (copied exactly) and "output" (your result). No missing or duplicate record IDs.`;
    const context = JSON.stringify(records);
    if (context.length > 60000) invalid('A part context exceeds 60,000 characters; use smaller records.');
    planned.push({
      part_key: `part-${index + 1}`, part_label: `Part ${index + 1}`,
      client_request_id: `job-${id}-p${index + 1}`,
      offer_cents: Math.floor(budget / parts) + (index < budget % parts ? 1 : 0),
      record_ids: records.map(record => record.id),
      prompt, context, rubric: rubric(input.part_rubrics?.[index] ?? input.rubric), max_tokens: maxTokens,
    });
  }
  const plan = { endpoint, client_job_key: `job-${id}`, budget_cents: budget, model, record_ids: ids, parts: planned };
  return { version: 'atm-buyer-job/v1', plan, plan_sha256: digest(plan), job_id: null, buyer_id: null, tasks: {} };
}
export function saveJob(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
export function loadJob(file) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.version !== 'atm-buyer-job/v1' || digest(state.plan) !== state.plan_sha256) throw new JobError('JOB_PLAN_CHANGED', 'Job plan changed or has an unsupported version.', 'Restore the original private plan before resuming; do not generate new request keys.');
  return state;
}
function acquire(file) {
  const lockPath = `${file}.lock`;
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new JobError('JOB_LOCKED', 'Job lock needs inspection.', 'Check the previous process before removing its lock.');
    try { process.kill(pid, 0); throw new JobError('JOB_LOCKED', 'Another process is operating this job.', 'Wait for that process to finish.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(lockPath);
  }
  const fd = fs.openSync(lockPath, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid));
  return () => { fs.closeSync(fd); fs.unlinkSync(lockPath); };
}
function parseItems(answer, expectedIds) {
  const text = answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length !== expectedIds.length) throw new Error('Wrong record count');
  const found = new Set();
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || !expectedIds.includes(item.id) || found.has(item.id) ||
        !Object.hasOwn(item, 'output') || Object.keys(item).some(key => !['id', 'output'].includes(key))) throw new Error('Invalid aggregate record');
    found.add(item.id);
  }
  return parsed;
}
export async function collectJob(state, client) {
  if (!state.job_id) return { status: 'NOT_POSTED', parts: [], records: [] };
  const snapshot = await client.tool('get_job', { job_id: state.job_id });
  const parts = []; const records = [];
  for (const planned of state.plan.parts) {
    const task = snapshot.parts.filter(part => part.part_key === planned.part_key).sort((a, b) => (b.attempt ?? 1) - (a.attempt ?? 1))[0];
    const status = { part_key: planned.part_key, task_id: task?.task_id ?? null, seller_id: task?.seller_id ?? null,
      status: task?.status ?? 'NOT_POSTED', commitment_verified: false, included: false,
      replacement_status: task?.replacement_status ?? null };
    if (task?.status === 'APPROVED') {
      const result = await client.tool('get_result', { task_id: task.task_id });
      status.commitment_verified = result.task?.task_id === task.task_id && result.task?.status === 'APPROVED' && result.result?.commitment_verified === true;
      if (status.commitment_verified) {
        try { records.push(...parseItems(result.result.answer, planned.record_ids)); status.included = true; }
        catch { status.error = 'INVALID_PART_OUTPUT'; }
      } else status.error = 'UNVERIFIED_RESULT';
    }
    parts.push(status);
  }
  const complete = parts.every(part => part.included);
  return { job_id: state.job_id, status: complete ? 'COMPLETE' : parts.some(part => ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(part.status) || part.error) ? 'PARTIAL_FAILURE' : 'IN_PROGRESS',
    authorized_budget_cents: state.plan.budget_cents, server_budget: { reserved_cents: snapshot.job.reserved_cents, spent_cents: snapshot.job.spent_cents },
    expected_parts: state.plan.parts.length, parts,
    records: state.plan.record_ids.flatMap(id => records.filter(record => record.id === id)) };
}
export async function runJob(file, client, endpoint, { timeoutSeconds = 180, now = Date.now, sleep = delay, postFields } = {}) {
  const release = acquire(file);
  try {
    const state = loadJob(file);
    if (state.plan.endpoint !== endpoint) throw new JobError('JOB_ENDPOINT_MISMATCH', 'Job belongs to a different marketplace.', 'Restore its original endpoint; do not migrate an in-flight job.');
    const tools = await client.tools();
    const names = tools.tools.map(tool => tool.name);
    const posting = tools.tools.find(tool => tool.name === 'post_task');
    if (!['create_job', 'get_job'].every(name => names.includes(name)) || !posting?.inputSchema?.properties?.client_request_id) throw new JobError('JOB_SERVER_NOT_READY', 'Marketplace does not advertise durable job posting.', 'Wait for the v0.3 server deployment before posting this job.');
    const info = await client.tool('marketplace_info');
    if (!postFields) throw new JobError('JOB_PRICING_NOT_READY', 'Task-offer pricing adapter has not been enabled.', 'Wait for the published pricing contract and server deployment.');
    if (state.plan.parts.some(part => part.offer_cents < info.payments.min_cents) || !info.models.some(model => model.model_id === state.plan.model)) invalid('Planned parts do not meet the current minimum price or model allowlist.');
    postFields(state.plan.parts[0].offer_cents, info);
    const who = await client.tool('whoami');
    const buyer = who.agent_id ?? who.agent?.agent_id ?? who.id;
    if (who.kind !== 'buyer') throw new JobError('JOB_BUYER_REQUIRED', 'A buyer identity is required.');
    if (!buyer) throw new JobError('JOB_IDENTITY_UNAVAILABLE', 'Buyer identity could not be verified.');
    if (state.buyer_id && state.buyer_id !== buyer) throw new JobError('JOB_BUYER_CHANGED', 'The job belongs to another buyer.', 'Use its original buyer credential.');
    state.buyer_id = buyer; saveJob(file, state);
    if (!state.job_id) {
      const result = await client.tool('create_job', { label_public: 'Buyer job', budget_cents: state.plan.budget_cents, client_job_key: state.plan.client_job_key });
      state.job_id = result.job.job_id; saveJob(file, state);
    }
    const existing = await client.tool('get_job', { job_id: state.job_id });
    for (const part of state.plan.parts) {
      const known = existing.parts.filter(task => task.part_key === part.part_key).sort((a, b) => (b.attempt ?? 1) - (a.attempt ?? 1))[0];
      if (known) { state.tasks[part.part_key] = known.task_id; saveJob(file, state); continue; }
      // Both keys and private payload were durably stored before the first request.
      // On resume the server returns the accepted task even if its response was lost.
      const result = await client.tool('post_task', { job_id: state.job_id, part_key: part.part_key, part_label: part.part_label,
        client_request_id: part.client_request_id, prompt: part.prompt, context: part.context,
        allowed_models: [state.plan.model], rubric: part.rubric, max_tokens: part.max_tokens,
        ...postFields(part.offer_cents, info) });
      state.tasks[part.part_key] = result.task.task_id; saveJob(file, state);
    }
    const deadline = now() + timeoutSeconds * 1000;
    while (true) {
      const result = await collectJob(state, client);
      if (result.parts.some(part => part.status === 'AWAITING_PAYMENT') || result.status === 'COMPLETE' || result.parts.every(part => ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(part.status)) || now() >= deadline) return result;
      await sleep(Math.min(3000, deadline - now()));
    }
  } finally { release(); }
}
