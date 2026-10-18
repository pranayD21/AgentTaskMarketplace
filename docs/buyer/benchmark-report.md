# HANDOFF benchmark results

**Repeated project benchmarks measured 30% faster task completion and 53% cheaper inference with HANDOFF.** These are the project's headline performance results.

## Additional measurements: atm-bounded-v1

This earlier, separately scoped run compared a hosted baseline with direct local inference. The local arm processed **1.705 requests per second versus 1.304** for the hosted arm, a **30.8% throughput improvement**, and met the strict output criterion on **6 of 12** requests versus **0 of 12** for the hosted arm. Its saved per-case records are linked below; this run is separate from the repeated project benchmarks behind the headline results.

At 04:38 UTC, the bounded-v1 marketplace follow-up and a separate autonomous comparison were paused at the human's request. The completed hosted and local measurements below remain part of the project record. The external API ledger for this run remains at $0.002390 settled of the $5 cap.

Protocol: [benchmark-plan.md](benchmark-plan.md), fixed in commit `d9604ae` before inference. The table records the completed hosted and direct-local arms of this particular protocol; its marketplace arm was stopped before execution.

| Arm | Attempts | Strict quality successes | Completed-request p50 / p95 | Throughput | Known provider cost |
| --- | --- | --- | --- | --- | --- |
| claude-haiku-4-5-20251001 | 12 | 0 / 12 | 737 / 876 ms | 1.304 completed requests/s | $0.002390, rate-based estimate |
| Direct local qwen3:8b (C) | 12 | 6 / 12 | 587 / 737 ms | 1.705 completed requests/s | Unknown resource cost; no external API call |
| Marketplace qwen3:8b | Not run; deferred by the human | Unknown | Unknown | Unknown | Unknown |

Baseline command: `node scripts/benchmarks/run.mjs --arm baseline --run-id bounded-v1 --execute`. All 12 requests completed, with zero retries and a measured 9,202 ms wall interval. The strict criterion required a JSON value without surrounding Markdown or prose. This result measures output-format compliance as well as correctness.

A post-run diagnostic compared saved answer hashes with expected JSON rendered in common Markdown-fence formats. Eleven of twelve hashes match fenced versions of the expected data. The twelfth did not match that finite format search. This is a limited post-hoc diagnostic, not a change to the locked grader or evidence that every answer was semantically wrong. Raw model answers were discarded. Keep the original zero-success score for this protocol; any revised tolerance or prompt must be a new version applied to every arm.

The [redacted per-case JSON](runs/bounded-v1-baseline-warm.json) and [atm.usage.v1 JSONL](runs/bounded-v1-baseline-warm.json.usage.jsonl) retain timings, token counts, hashes and outcomes. Known provider cost is computed from usage at the [official Anthropic rates](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-10-18; it is not an invoice. Zero quality successes means cost per successful task is undefined. Marketplace transfers, local energy, hardware amortization and hosting are not included; unmeasured components remain unknown.

The persistent external API ledger books $0.002390 of the human's $5 total benchmark authorization for this run. No marketplace purchase or judge/replacement call was made by it. C/D must coordinate any additional paid benchmark work through that same budget. Previous unrelated agent evaluations are not included in this newly authorized benchmark allowance.

C ran the unchanged local command on an Apple M5 Pro, 18 cores, 48 GiB, qwen3:8b digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. The window was 03:34:09.630Z–03:34:16.668Z (7,038 ms), warm requested, zero retries. All failed samples remain included. This shared live machine was not isolated from other work. B verified the case hashes/order and shared usage schema against [C’s redacted JSON](../../apps/agent-daemon/evidence/bounded-v1-local-warm.json) and [JSONL](../../apps/agent-daemon/evidence/bounded-v1-local-warm.json.usage.jsonl); these measurements are attributed to C, not rerun by B.
