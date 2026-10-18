import { expect, it } from 'vitest';
import { sellerUsageRecord } from '../src/usage.mjs';
const attempt = { schema_version: 1, event: 'finished', started_at: '2026-10-18T03:00:00Z', finished_at: '2026-10-18T03:00:01Z', elapsed_ms: 1000, status: 'submitted', model_id: 'qwen3:8b', seller_usage: null, secret: 'PRIVATE' };
const context = { run_id: 'run_fixture', case_id: 'case_fixture', arm: 'marketplace', success: false, retries: 0 };
it('requires the buyer outcome and preserves unknown usage rather than inferring approval from submission', () => {
  expect(() => sellerUsageRecord(attempt, { ...context, success: undefined })).toThrow('INVALID_BENCHMARK_CONTEXT');
  const result=sellerUsageRecord(attempt, context);
  expect(result).toMatchObject({ schema: 'atm.usage.v1', success: false, input_tokens: null, energy_wh: null, cost_usd: null });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(() => sellerUsageRecord({ ...attempt, event: 'started' }, context)).toThrow('INCOMPLETE_ATTEMPT');
});
it('converts energy units while retaining its estimated basis and provider counts', () => {
  const result=sellerUsageRecord({ ...attempt, seller_usage: { source: 'ollama', input_tokens: 10, output_tokens: 2, cached_input_tokens: 0 }, energy: { method: 'estimated_from_configured_whole_machine_watts', kwh: 0.001 } }, context);
  expect(result).toMatchObject({ input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: null, energy_wh: 1, energy_basis: 'estimated' });
});
