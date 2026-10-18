// First-party synthetic fixtures, dedicated to the public domain under CC0-1.0.
// Public benchmark definitions; never put user task payloads in this module.
import { createHash } from 'node:crypto';
export const VERSION = 'atm-bounded-v1';
export const SYSTEM = 'You are a worker model executing a task for another agent. Follow the instruction precisely and answer directly without preamble.';
export const MODEL = 'claude-haiku-4-5-20251001';
export const LOCAL_MODEL = 'qwen3:8b';
export const MAX_TOKENS = 256;
export const TEMPERATURE = 0.2;
export const RATE = Object.freeze({ input: 1, output: 5, cache_read: 0.1, cache_write: 2 }); // USD / million tokens = microUSD / token
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function workloads() {
  return [
    ...[17, 29].map((seed, index) => ({
      id: `invoice-${index + 1}`, family: 'integer-invoice',
      prompt: `Compute the total in integer cents for an invoice with 3 items priced at ${seed * 11} cents each and 2 items priced at ${seed * 7} cents each. Return only a JSON object with the integer key "total_cents".`,
      expected: { total_cents: seed * 47 },
    })),
    ...[[37, 12, 37, 5, 21], [14, 8, 31, 8, 3]].map((values, index) => ({
      id: `sort-${index + 1}`, family: 'deduplicate-sort',
      prompt: `Remove duplicates and sort these integers in ascending order: ${JSON.stringify(values)}. Return only a JSON object with the key "values" containing the integer array.`,
      expected: { values: [...new Set(values)].sort((a, b) => a - b) },
    })),
    ...[4, 7].map((seed, index) => ({
      id: `inventory-${index + 1}`, family: 'structured-extraction',
      prompt: `Inventory record: red=${seed + 2}, blue=${seed * 3}, red=${seed + 1}, green=${seed}. Combine repeated colors by adding quantities. Return only a JSON object with exactly the integer keys "blue", "green", and "red".`,
      expected: { blue: seed * 3, green: seed, red: seed * 2 + 3 },
    })),
  ].map(item => ({ ...item, version: VERSION, case_sha256: hash({ version: VERSION, ...item }) }));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function grade(answer, item) {
  try { return JSON.stringify(canonical(JSON.parse(answer.trim()))) === JSON.stringify(canonical(item.expected)); }
  catch { return false; }
}
export function order(repeats = 2, seed = 20261018) {
  const rows = Array.from({ length: repeats }, (_, repeat) => workloads().map(item => ({ item, repeat }))).flat();
  let state = seed >>> 0;
  for (let i = rows.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1); [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}
export function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarize(records) {
  const completed = records.filter(row => row.status === 'completed');
  const success = completed.filter(row => row.quality_pass === true);
  const latencies = completed.map(row => row.latency_ms);
  const starts = records.map(row => Date.parse(row.started_at)).filter(Number.isFinite);
  const ends = records.map(row => Date.parse(row.ended_at)).filter(Number.isFinite);
  const wallMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null;
  const costKnown = records.length > 0 && records.every(row => Number.isFinite(row.provider_cost_microusd));
  const totalCost = costKnown ? records.reduce((sum, row) => sum + row.provider_cost_microusd, 0) : null;
  return {
    attempts: records.length, completed: completed.length, quality_successes: success.length,
    success_rate: records.length ? success.length / records.length : null,
    failure_rate: records.length ? (records.length - success.length) / records.length : null,
    p50_latency_ms: quantile(latencies, 0.5), p95_latency_ms: quantile(latencies, 0.95),
    latency_population: 'completed requests, including quality failures; timeouts reported separately',
    wall_ms: wallMs, completed_per_second: wallMs > 0 ? completed.length / (wallMs / 1000) : null,
    retries: records.reduce((sum, row) => sum + (row.retries ?? 0), 0),
    known_provider_cost_usd: totalCost === null ? null : totalCost / 1e6,
    provider_cost_per_quality_success_usd: totalCost === null || !success.length ? null : totalCost / 1e6 / success.length,
    total_system_cost_usd: null, // Filled by D only when all resource components are measured/allocated.
  };
}
export function usageRecords(report) {
  const main = report.records.filter(row => row.ended_at).map(row => ({
    schema: 'atm.usage.v1', run_id: report.run_id, case_id: row.sample_id, arm: report.arm,
    component: report.arm === 'local' ? 'seller' : 'buyer',
    task_id: row.task_id ?? null,
    provider: report.arm === 'baseline' ? 'anthropic' : report.arm === 'local' ? 'ollama' : 'agent-task-marketplace',
    model: report.model, model_version: report.model_digest ?? report.provider_model ?? null,
    started_at: row.started_at, ended_at: row.ended_at, latency_ms: row.latency_ms ?? null,
    load_ms: Number.isFinite(row.load_duration_ns) ? row.load_duration_ns / 1e6 : null,
    input_tokens: row.input_tokens, output_tokens: row.output_tokens,
    cache_read_tokens: row.cache_read_input_tokens, cache_write_tokens: row.cache_creation_input_tokens,
    retries: row.retries, success: row.status === 'completed' && row.quality_pass === true,
    energy_wh: row.energy_wh ?? null, energy_basis: null, hardware: report.hardware ? JSON.stringify(report.hardware) : null,
    cost_usd: Number.isFinite(row.provider_cost_microusd) ? row.provider_cost_microusd / 1e6 : null,
    cost_basis: Number.isFinite(row.provider_cost_microusd) ? 'list_price' : null,
    price_source: report.rate_source?.url ?? null, price_date: report.rate_source?.checked_on ?? null,
    notes: `phase=${report.phase}; status=${row.status}; output redacted; system cost incomplete`,
  }));
  const payment = report.records.filter(row => row.ended_at && row.payment).map(row => ({
    schema:'atm.usage.v1',run_id:report.run_id,case_id:row.sample_id,arm:'marketplace',component:'payment',task_id:row.task_id,
    provider:'stripe',model:'stripe-test-card',started_at:row.started_at,ended_at:row.ended_at,latency_ms:row.latency_ms,
    input_tokens:null,output_tokens:null,retries:0,success:row.payment.state==='CAPTURED',energy_wh:null,
    cost_usd:row.payment.hypothetical_live_card_fee_usd,cost_basis:row.payment.hypothetical_live_card_fee_usd===null?null:'estimate',
    price_source:'https://stripe.com/pricing',price_date:'2026-10-18',
    notes:`Hypothetical live US domestic-card processing fee, NOT incurred in Stripe TEST. Buyer test charge ${row.stripe_test_charge_cents ?? 'unknown'}c; offer ${row.payment.posted_offer_cents}c; transferred ${row.payment.payout_transferred_cents ?? 'unknown'}c. Buyer price is not a system resource cost.`,
  }));
  return [...main,...payment];
}
