# Seller measurements for B and D

Enable `--measurement-file .atm-state/measurements/c-seller.jsonl --computer-id C` on the seller. The file is local, ignored by Git and written with mode 600. The default operation does not measure energy. Add `--estimated-watts NUMBER` only when you have a defensible whole-machine power estimate and record its source in the benchmark report.

Each attempted task gets a unique `attempt_id` with one `started` row and, if the host survives, one `finished` row. Retried work gets another attempt ID. A start without a finish means incomplete observation; do not count it as free or successful. `status=submitted` means the seller submitted a result, not that the judge approved it. Join server outcome/settlement evidence using task/result IDs.

## Local JSONL version 1

| Field | Meaning |
| --- | --- |
| `schema_version`, `attempt_id`, `kind`, `event` | Version 1; unique attempt; `task_attempt` or `model_canary`; `started` or `finished`. |
| `computer_id`, `seller_id`, `task_id`, `claim_id`, `result_id` | Safe correlation metadata. Unknown IDs are null. Includes `job_id`, `part_key` and `task_attempt` from A's v0.3 task metadata when present. Free-form public labels are omitted. |
| `model_id`, `model_digest`, `runtime`, `component_sha256`, `wassette_version` | Runtime configuration and model inventory, reported by the local host. |
| `hardware` | OS, architecture, CPU model/count, memory bytes and Node version. No hostname, username or device serial. |
| `started_at`, `finished_at`, `elapsed_ms`, `runtime_ms` | UTC timestamps, monotonic host attempt duration, and runner duration when known. Attempt duration includes transport overhead. |
| `seller_usage.input_tokens`, `output_tokens`, `cached_input_tokens` | Ollama prompt/generated/cache counts, or null. A missing cache field remains null. |
| `seller_usage.total_duration_ms`, `load_duration_ms`, `prompt_eval_duration_ms`, `eval_duration_ms` | Provider generation, loading, prompt evaluation and generation timings converted from nanoseconds to milliseconds. |
| `status`, `error_code`, `usage_complete` | Submitted/passed/failed, safe error code and whether every usage field was reported. Unknown usage is never silently zero. |
| `energy` | `not_measured` with null kWh, or a labelled whole-machine watts estimate over attempt wall time. |
| `provenance` | `local_host_reported_not_attested`. |

The count and duration sources follow the [official Ollama chat response fields](https://docs.ollama.com/api/chat), checked October 17, 2026. Durations are nanoseconds at the provider and milliseconds in the sidecar. No prompt, answer, context, rubric, key, envelope or arbitrary provider error is written. Unknown fields from a component/provider are dropped.

The measured Wasm export retains completed inference usage even when `submit_result` later fails. If the process dies or the provider times out before reporting usage, costs remain incomplete. Node fallback records successful inference before submission too. Older components can still run but may provide no usage. File-write failure emits a fixed warning and never retries an already submitted task.

Energy estimate:

```text
estimated_kwh = configured_watts * attempt_elapsed_ms / 3,600,000,000
```

This includes whole-machine power during transport and waiting. It is not an incremental measurement, and concurrent workers can cause double-counting. D must choose and disclose an allocation policy or use a metered interval with a measured idle baseline. Hardware amortization, electricity rates, hosting, judge/replacement costs, buyer-controller calls and payment fees remain separate inputs. Do not infer them from the seller's quoted price.

B can consume these rows now as a local artifact. A published `atm.usage.v1` in CONTRACT section 11. Import `sellerUsageRecord` from `apps/agent-daemon/src/usage.mjs` and pass a finished row plus `{run_id, case_id, arm, success, retries}`. The buyer supplies the actual quality outcome; submission alone cannot set success. The adapter converts estimated kWh to Wh and retains null for unknown prices/usage. It rejects unfinished rows so the harness must separately account for incomplete attempts. No additional fields are sent to `submit_result` or persisted centrally by this change. B/D should publish missing-data coverage alongside any total or per-success cost.

## Verification commands

```sh
pnpm -r typecheck
pnpm test
pnpm build:runner
ATM_TEST_WASSETTE=1 pnpm --filter @atm/agent-daemon test
pnpm smoke
pnpm daemon --role seller --runtime wassette --canary-only --model qwen3:8b --computer-id C --measurement-file .atm-state/measurements/c-canary.jsonl
```

Only the last command runs the real installed model. It creates no marketplace task. The smoke suite uses labelled fake Ollama, memory storage and mock money. The Wassette suite uses real sandbox processes with synthetic local HTTP services.

## Confidential inference follow-up for A

The existing host can inspect Wasm memory and Ollama inference. A future design needs a threat model for the server, seller OS, judge and model provider, then an execution environment with verifiable CPU/GPU confidentiality for the entire inference path. Keeping an enclave around an ordinary host Ollama call would leave plaintext exposed.

Before releasing a task key, the buyer or trusted release service would verify an attestation bound to a fresh nonce, the runner/model measurement and that task's public key. Bind task, claim, runtime measurement and result commitment together, reject replayed/expired evidence, and define key revocation. Buyer-held decryption keys would also remove the current server's ability to read results. E needs an equivalent analysis for judge execution.

Acceptance would require a tested chain of attestation verification, key release and confidential model execution on selected hardware. A local canary or self-reported digest cannot substitute for that evidence. This is a design outline; no such environment is implemented here.

Task-price attempts include `offered_price_cents`, the public offer observed before claiming. This is a proposed payment, not proof of spend or a resource cost. Reconcile actual payment with the server settlement and keep it separate from token/energy costs.
