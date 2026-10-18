/** Map a completed local seller attempt to CONTRACT section 11. The buyer supplies the outcome. */
export function sellerUsageRecord(attempt, context) {
  const text = (v) => typeof v === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(v) ? v : null;
  const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const count = (v) => Number.isSafeInteger(v) && amount(v) !== null ? v : null;
  if (attempt?.schema_version !== 1 || attempt.event !== 'finished') throw new Error('INCOMPLETE_ATTEMPT');
  if (!text(context?.run_id) || !text(context?.case_id) || !['local', 'marketplace'].includes(context.arm) || typeof context.success !== 'boolean' || count(context.retries) === null) throw new Error('INVALID_BENCHMARK_CONTEXT');
  const start = Date.parse(attempt.started_at), end = Date.parse(attempt.finished_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || amount(attempt.elapsed_ms) === null || !text(attempt.model_id)) throw new Error('INVALID_MEASUREMENT');
  const usage = attempt.seller_usage?.source === 'ollama' ? attempt.seller_usage : {};
  const estimated = attempt.energy?.method === 'estimated_from_configured_whole_machine_watts' && amount(attempt.energy.kwh) !== null;
  const hw = attempt.hardware ?? {};
  return {
    schema: 'atm.usage.v1', run_id: context.run_id, case_id: context.case_id, arm: context.arm, component: 'seller',
    task_id: text(attempt.task_id), provider: 'ollama', model: attempt.model_id, model_version: text(attempt.model_digest),
    started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(), latency_ms: attempt.elapsed_ms,
    load_ms: amount(usage.load_duration_ms), input_tokens: count(usage.input_tokens), output_tokens: count(usage.output_tokens),
    cache_read_tokens: count(usage.cached_input_tokens), cache_write_tokens: null,
    retries: context.retries, success: context.success, energy_wh: estimated ? attempt.energy.kwh * 1000 : null,
    energy_basis: estimated ? 'estimated' : null,
    hardware: { cpu_model: typeof hw.cpu_model === 'string' && /^[A-Za-z0-9 ()@.,_+-]{1,120}$/.test(hw.cpu_model) ? hw.cpu_model : null, platform: text(hw.platform), arch: text(hw.arch), cpu_count: count(hw.cpu_count), memory_bytes: count(hw.memory_bytes) },
    cost_usd: null, cost_basis: null, price_source: null, price_date: null,
    notes: 'Local host reports; not attested. Unknown usage/cost remains null. Energy, if present, is a whole-machine estimate requiring allocation.',
  };
}
