#!/usr/bin/env node
// Synthetic database-only fixtures; removed in finally. No provider calls.
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env');
const base = process.env.INSFORGE_BASE_URL, key = process.env.INSFORGE_API_KEY;
if (!base || !key) throw new Error('Insforge configuration is required');
const id = randomUUID().replaceAll('-', '');
const buyer = `verify_b_${id}`, job = `verify_j_${id}`;
const row = { id: `verify_t_${id}`, buyer_id: buyer, allowed_models: ['qwen3:8b'], max_price_cents: 75, price_cents: 75, max_runtime_s: 180, status: 'AWAITING_PAYMENT', payment_mode: 'card', payment_state: 'POSTING', post_state: 'HOLDING', pricing_mode: 'task_offer', claim_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: new Date(Date.now()+3600000).toISOString(), job_id: job, part_key: 'one', attempt: 1 };
const literal = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
async function sql(query) {
  const r = await fetch(`${base}/api/database/advance/rawsql`, {method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({query})});
  if (!r.ok) throw new Error(`Postgres verification HTTP ${r.status}`);
  return (await r.json()).rows;
}
function check(value, message) { if (!value) throw new Error(message); }
try {
  await sql(`insert into agents (id,kind,display_name,api_key_hash,spend_cap_cents) values ('${buyer}','buyer','database verification','verify_${id}',150); insert into jobs (id,buyer_id,budget_cents) values ('${job}','${buyer}',100);`);
  const first = await sql(`select atm_prepare_task(${literal(row)}) as result`);
  check(first[0]?.result?.task?.id === row.id, 'First task was not recorded');
  const second = await sql(`select atm_prepare_task(${literal({...row,id:`verify_t2_${id}`,part_key:'two'})}) as result`);
  check(second[0]?.result?.error === 'JOB_BUDGET_EXCEEDED', 'Job cap was not enforced');
  const [counts] = await sql(`select (select reserved_cents from agents where id='${buyer}') as buyer_reserved, (select reserved_cents from jobs where id='${job}') as job_reserved, (select count(*)::int from tasks where buyer_id='${buyer}') as tasks`);
  check(counts.buyer_reserved === 75 && counts.job_reserved === 75 && counts.tasks === 1, 'Reservation or task count mismatch');
  console.log('PASS: Postgres atomic task/buyer/job reservation and job-cap refusal. No payment calls.');
} finally {
  await sql(`delete from tasks where id in ('${row.id}','verify_t2_${id}') and buyer_id='${buyer}'; delete from jobs where id='${job}' and buyer_id='${buyer}'; delete from agents where id='${buyer}' and api_key_hash='verify_${id}';`);
  console.log('Synthetic verification fixtures removed.');
}
