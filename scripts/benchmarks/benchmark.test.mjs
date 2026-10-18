import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reserve, settle } from './budget.mjs';
import { workloads, grade, order, summarize } from './workloads.mjs';

test('paired workloads have stable ordering and reject partial/wrong/extra output', () => {
  assert.deepEqual(order(), order()); assert.equal(order().length, 12);
  for (const item of workloads()) {
    assert.equal(grade(JSON.stringify(item.expected), item), true);
    assert.equal(grade(`preamble ${JSON.stringify(item.expected)}`, item), false);
    assert.equal(grade(JSON.stringify({ ...item.expected, unexpected: 1 }), item), false);
  }
});
test('unknown API outcomes retain budget after restart and cannot be repeated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-budget-')); const file = path.join(directory, 'budget.json');
  try {
    reserve(file, 'one', 4_000_000);
    assert.throws(() => reserve(file, 'one', 4_000_000), /already reserved/);
    assert.throws(() => reserve(file, 'two', 2_000_000), /exceeded/);
    assert.throws(() => settle(file, 'one', null), /Unknown/);
    settle(file, 'one', 1000);
    reserve(file, 'two', 4_999_000);
    assert.throws(() => reserve(file, 'three', 1), /exceeded/);
    assert.throws(() => reserve(file, 'three', 1, 6_000_000), /authorized/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('summary counts quality failures, preserves unknown costs, and uses nearest-rank quantiles', () => {
  const rows = [10, 20, 30, 40].map((latency_ms, index) => ({ status: 'completed', quality_pass: index !== 3, latency_ms, provider_cost_microusd: null }));
  const summary = summarize(rows);
  assert.equal(summary.success_rate, 0.75); assert.equal(summary.p50_latency_ms, 20); assert.equal(summary.p95_latency_ms, 40);
  assert.equal(summary.known_provider_cost_usd, null); assert.equal(summary.total_system_cost_usd, null);
});
