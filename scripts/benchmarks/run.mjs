#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, normalizeEndpoint, readIdentity } from '../buyer.mjs';
import { lock, reserve, settle, writeAtomic, writeTextAtomic } from './budget.mjs';
import { taskOfferFields } from '../../skills/marketplace/scripts/job.mjs';
import { VERSION, SYSTEM, MODEL, LOCAL_MODEL, MAX_TOKENS, TEMPERATURE, RATE, hash, order, grade, summarize, usageRecords } from './workloads.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const { values } = parseArgs({ options: {
  arm: { type: 'string', default: 'baseline' }, 'run-id': { type: 'string', default: 'bounded-v1' },
  execute: { type: 'boolean', default: false }, repeats: { type: 'string', default: '2' },
  phase: { type: 'string', default: 'warm' }, 'dedicated-ollama': { type: 'boolean', default: false },
  computer: { type: 'string', default: 'B' }, output: { type: 'string' },
  'marketplace-budget-cents': { type: 'string' }, 'judge-reservation-usd': { type: 'string' },
} });
const arm = values.arm;
const repeats = Number(values.repeats);
if (!['baseline', 'local', 'marketplace'].includes(arm) || !['warm', 'cold'].includes(values.phase) ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(values['run-id']) || !/^[ABCDE]$/.test(values.computer) ||
    !Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Invalid benchmark options');
if (values.phase === 'cold' && (arm !== 'local' || !values['dedicated-ollama'])) throw new Error('Cold runs require a dedicated local Ollama instance');
const runId = `${values['run-id']}-${arm}-${values.phase}`;
const samples = order(repeats);
const fingerprint = hash({ version: VERSION, model: arm === 'baseline' ? MODEL : LOCAL_MODEL, arm, phase: values.phase,
  settings: { max_tokens: MAX_TOKENS, temperature: TEMPERATURE, system_sha256: hash(SYSTEM) }, samples: samples.map(({ item, repeat }) => [item.case_sha256, repeat]) });
const statePath = path.join(root, '.atm-state/benchmarks', `${runId}.json`);
const budgetPath = path.join(root, '.atm-state/benchmark-api-budget.json');
const output = path.resolve(values.output ?? path.join(root, 'docs/buyer/runs', `${runId}.json`));
let report = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {
  schema: 'atm-benchmark-local/v1', run_id: runId, workload: VERSION, fingerprint, arm,
  model: arm === 'baseline' ? MODEL : LOCAL_MODEL, phase: values.phase, computer: values.computer,
  settings: { temperature: TEMPERATURE, max_tokens: MAX_TOKENS, thinking: false, concurrency: 1, retries: 0 },
  hardware: arm === 'local' ? { arch: os.arch(), platform: os.platform(), cpu: os.cpus()[0]?.model ?? null, memory_bytes: os.totalmem() } : null,
  records: [],
};
if (report.fingerprint !== fingerprint) throw new Error('Run configuration changed; use a new run ID instead of mixing results');
function save() {
  report.summary = summarize(report.records);
  writeAtomic(statePath, report);
  writeAtomic(output, report);
  writeTextAtomic(`${output}.usage.jsonl`, usageRecords(report).map(row => JSON.stringify(row)).join('\n') + '\n');
}
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
let client;
let endpoint;
let ollama;
let judgeReservation;
let runBudget;
let releaseRun;
const terminal = ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'];
try {
  if (!values.execute) {
    console.log(JSON.stringify({ action: 'PLAN_ONLY', run_id: runId, fingerprint, arm, model: report.model,
      sample_count: samples.length, case_ids: samples.map(({ item, repeat }) => `${item.id}/${repeat}`),
      external_api_cap_usd: 5, output, note: 'No model or marketplace call made. Add --execute only for an authorized run.' }, null, 2));
  } else {
    if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
    releaseRun = lock(`${statePath}.lock`);
    if (fs.existsSync(statePath)) report = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (report.fingerprint !== fingerprint) throw new Error('Run changed before lock acquisition');
    if (arm === 'baseline') {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing');
      const model = await json(`https://api.anthropic.com/v1/models/${MODEL}`, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });
      if (model.id !== MODEL) throw new Error('Pinned baseline model is unavailable');
      report.provider_model = model.id;
      report.rate_source = { checked_on: '2026-10-18', url: 'https://platform.claude.com/docs/en/about-claude/pricing', usd_per_million_tokens: RATE };
    } else if (arm === 'local') {
      ollama = normalizeEndpoint(process.env.OLLAMA_URL ?? 'http://localhost:11434');
      const inventory = await json(`${ollama}/api/tags`);
      const model = inventory.models?.find(item => item.name === LOCAL_MODEL);
      if (!model?.digest) throw new Error('Requested local model/digest is not installed');
      const version = await json(`${ollama}/api/version`);
      report.ollama_version = version.version; report.model_digest = model.digest;
      if (!report.records.length && values.phase === 'warm') {
        const warmup = await json(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: LOCAL_MODEL, messages: [], stream: false, keep_alive: '5m' }) });
        report.warmup = { total_duration_ns: warmup.total_duration ?? null, load_duration_ns: warmup.load_duration ?? null };
      }
    } else {
      endpoint = normalizeEndpoint(process.env.MARKETPLACE_URL ?? '');
      const key = process.env.ATM_API_KEY ?? readIdentity(path.join(root, '.atm-state/buyer.json'), endpoint)?.api_key;
      if (!key) throw new Error('Marketplace benchmark requires an existing buyer; registration is never automatic');
      runBudget = Number(values['marketplace-budget-cents']);
      judgeReservation = Math.ceil(Number(values['judge-reservation-usd']) * 1e6);
      if (!Number.isSafeInteger(runBudget) || runBudget < samples.length * 100 ||
          !Number.isSafeInteger(judgeReservation) || judgeReservation <= 0) throw new Error('Specify an authorized test-cent budget and D-reviewed worst-case judge API reservation');
      client = createClient(endpoint, key); await client.initialize();
      const info = await client.tool('marketplace_info');
      taskOfferFields(100, info);
      if (info.payments.mode !== 'card') throw new Error('This benchmark protocol currently requires Stripe TEST card mode');
      const who = await client.tool('whoami');
      const remaining = samples.length - report.records.filter(row => row.task_id).length;
      if (who.spend.available_cents < remaining * 100) throw new Error('Existing buyer lacks the required remaining capacity; no cap/identity change allowed');
      report.buyer_id = who.agent_id ?? who.agent?.agent_id ?? null;
      report.marketplace = endpoint; report.marketplace_budget_cents = runBudget;
    }
    for (const { item, repeat } of samples) {
      const sampleId = `${item.id}-${repeat}`;
      let row = report.records.find(record => record.sample_id === sampleId);
      if (row && row.status !== 'inflight') continue;
      if (row && !(arm === 'marketplace' && row.task_id)) throw new Error('Ambiguous prior attempt: reconcile it before retrying; no automatic duplicate request');
      const attemptId = `${runId}/${sampleId}`;
      if (!row) {
        row = { sample_id: sampleId, case_id: item.id, case_sha256: item.case_sha256, repeat,
          started_at: new Date().toISOString(), status: 'inflight', retries: 0,
          input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null,
          provider_cost_microusd: null, energy_wh: null, quality_pass: false };
        report.records.push(row); save();
      }
      try {
        let answer;
        if (arm === 'baseline') {
          // Reserve the full pinned model context at the highest cache-write rate,
          // plus max output. Unknown outcomes keep this amount booked across restarts.
          reserve(budgetPath, attemptId, 200000 * RATE.cache_write + MAX_TOKENS * RATE.output);
          const result = await json('https://api.anthropic.com/v1/messages', { method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: MODEL, system: SYSTEM, messages: [{ role: 'user', content: item.prompt }], temperature: TEMPERATURE, max_tokens: MAX_TOKENS, stream: false }),
          });
          if (result.model !== MODEL) throw new Error('Provider returned a different model');
          answer = result.content.filter(block => block.type === 'text').map(block => block.text).join('');
          for (const field of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) row[field] = Number.isSafeInteger(result.usage?.[field]) ? result.usage[field] : null;
          if (['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some(field => row[field] === null)) throw new Error('Provider usage incomplete; conservative reservation retained');
          row.provider_cost_microusd = Math.ceil(row.input_tokens * RATE.input + row.output_tokens * RATE.output + row.cache_read_input_tokens * RATE.cache_read + row.cache_creation_input_tokens * RATE.cache_write);
          settle(budgetPath, attemptId, row.provider_cost_microusd);
        } else if (arm === 'local') {
          if (values.phase === 'cold') await json(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: LOCAL_MODEL, messages: [], stream: false, keep_alive: 0 }) });
          row.started_at = new Date().toISOString();
          const result = await json(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: LOCAL_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: item.prompt }], stream: false, think: false, keep_alive: '5m', options: { num_predict: MAX_TOKENS, temperature: TEMPERATURE } }),
          });
          answer = result.message?.content ?? '';
          row.input_tokens = result.prompt_eval_count ?? null; row.output_tokens = result.eval_count ?? null;
          row.load_duration_ns = result.load_duration ?? null; row.inference_duration_ns = result.eval_duration ?? null;
          row.prompt_duration_ns = result.prompt_eval_duration ?? null;
        } else {
          if (!row.task_id) {
            reserve(budgetPath, attemptId, judgeReservation);
            const posted = await client.tool('post_task', { prompt: item.prompt, allowed_models: [LOCAL_MODEL],
              price_cents: 100, max_tokens: MAX_TOKENS, max_runtime_s: 180, expires_in_s: 600,
              rubric: { kind: 'contains_text', expected_text: Object.keys(item.expected)[0] } });
            row.task_id = posted.task.task_id; save();
          }
          let task;
          const deadline = Date.now() + 240000;
          do {
            ({ task } = await client.tool('get_task', { task_id: row.task_id }));
            if (terminal.includes(task.status)) break;
            if (Date.now() >= deadline) {
              if (task.status === 'OPEN') await client.tool('cancel_task', { task_id: row.task_id });
              throw new Error('MARKETPLACE_WAIT_TIMEOUT');
            }
            await delay(3000);
          } while (true);
          row.task_status = task.status; row.seller_id = task.seller_id;
          if (task.status !== 'APPROVED') throw new Error('Marketplace part did not receive approval; judge reservation retained pending usage evidence');
          const result = await client.tool('get_result', { task_id: row.task_id });
          if (result.result?.commitment_verified !== true) throw new Error('Commitment verification failed');
          answer = result.result.answer; row.commitment_verified = true;
          row.seller_runtime_ms = result.result.runtime_ms ?? null;
          row.stripe_test_charge_cents = result.settlement?.seller_payout_cents ?? null;
          row.stripe_test_refund_cents = result.settlement?.buyer_refund_cents ?? null;
          // This protocol uses contains_text. Approval takes the deterministic judge path:
          // no grading/replacement provider call. This is not total system cost.
          settle(budgetPath, attemptId, 0); row.judge_external_cost_microusd = 0;
        }
        row.output_sha256 = hash(answer); row.quality_pass = grade(answer, item); row.status = 'completed';
      } catch (error) {
        row.status = 'failed'; row.error_code = /^HTTP_\d+$/.test(error.message) ? error.message : 'ATTEMPT_FAILED';
        row.ended_at = new Date().toISOString(); row.latency_ms = Date.parse(row.ended_at) - Date.parse(row.started_at); save();
        throw new Error('Benchmark stopped after a failed attempt; inspect redacted state and reserved budget before resuming');
      }
      row.ended_at = new Date().toISOString(); row.latency_ms = Date.parse(row.ended_at) - Date.parse(row.started_at); save();
      console.log(JSON.stringify({ sample: sampleId, arm, status: row.status, quality_pass: row.quality_pass, latency_ms: row.latency_ms }));
    }
    save();
    console.log(JSON.stringify({ output, summary: report.summary }));
  }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { releaseRun?.(); }
