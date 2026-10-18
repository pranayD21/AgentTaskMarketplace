# Autonomous local buyer benchmark

## What this tests

C's local Qwen3 8B model receives one request: implement a utility module with eight specified functions. It chooses every tool call. In the network arm, the available tools include the hosted marketplace's MCP tools. The model can inspect the marketplace, choose task boundaries and prices, post work, continue writing code locally, retrieve results and submit the module. No prompt names computer D or assigns it a function.

D remains a general seller, polling for eligible tasks. C's existing general seller also stays running. Neither worker receives a pinned task ID. If C's buyer does not delegate, or D does not claim any work, the result must say so.

This replaces the interpretation of the earlier 160-line C/D rehearsal as an autonomy benchmark. That rehearsal established transport, concurrent workers and payment settlement; its parts were prepared by a human-directed agent.

## Fixed protocol: autonomous-v2

The initial `autonomous-v1` pilot was stopped before the network arm. Its combined submission tool exposed a remote-result field even in the local-only arm; Qwen filled that field with a benchmark ID, so the host rejected otherwise supplied code repeatedly. That run is invalid and its trace is preserved. Version 2 separates local code submission from remote-result submission and exposes the latter only in the network arm. No hidden tests or candidate scores were inspected to choose this fix.

- Dataset: [OpenAI HumanEval](https://github.com/openai/human-eval), revision `b9453e8f1865df0a0057a1383767caa400acfbcf`.
- Task IDs: 0, 12, 20, 32, 40, 53, 57 and 63, fixed before candidate generation. The fixture manifest records hashes and the MIT license. This is an eight-function subset, not a full HumanEval score.
- Both arms use the same function specifications and system prompt, Qwen3 8B model digest, temperature 0, seed 42, thinking disabled, 16,384-token context and 4,096-token response limit. The system asks for correctness and minimum elapsed time; it does not ask for delegation.
- Each arm gets a **600-second maximum**. Finish earlier when all answers are submitted or the model stops. Do not pad the run to ten minutes.
- Order is fixed: local first, network second. The same short, unrelated warm-up runs before each arm. This first pair is a feasibility measurement; order effects and run-to-run variance require later repetitions.
- Local arm: one C model conversation, local submission and wait tools; no marketplace access.
- Network arm: same local conversation plus discovered buyer MCP tool schemas. The model chooses any decomposition and remote prompts. The host enforces an existing-buyer ceiling of 600 Stripe TEST cents, 50–100 cents per post, Qwen3 8B only, and no new post in the last 45 seconds. Uncertain requests keep consuming the ceiling.
- Hidden functional tests are run after final submission, with a three-second execution limit per function. They are never sent to the buyer or seller, and no hidden-test feedback goes back into the model loop. Only one enclosing Markdown Python fence may be removed, identically for both arms; no code repairs are applied.
- Generated code runs under a macOS sandbox with a clean environment, resource limits, no network or subprocess access, and no access to host secrets. The grader refuses to run if the sandbox is unavailable.
- Marketplace payment approval checks only that the result contains `def `. It is format acceptance, **not functional correctness**. The benchmark's hidden tests determine correctness. Paid model judging is disallowed by the tool policy.
- Generation wall time includes local model inference, tool calls, queueing, worker execution and result retrieval. Grading duration is reported separately. Results received after the deadline cannot improve the score. Open unused listings are cancelled afterward; claimed work and uncertain payment outcomes remain visible for reconciliation.

## Evidence and interpretation

The private run directory is `.atm-state/autonomous-benchmark/<run-id>/`. It contains the frozen protocol, exact prompts/tool schemas, timestamped model/tool trace, final source files, posting journal, functional scores and settlement metadata. It is ignored by Git. Published evidence removes private prompts, generated answers and credentials, retaining hashes, task IDs, timestamps and measured outcomes.

Report the number of functions passed alongside elapsed time. Compute a full-success speedup only when both arms pass all eight. An early wrong answer is not a speedup. Report model-generated `post_task` calls, the actual claiming seller IDs, and whether D's output contributed to a submitted answer. Distinguish successful delegation from actual parallel execution and from a performance improvement.

The public marketplace may expose old registered sellers. Registration is not proof of a currently polling worker. D's readiness acknowledgment and actual claim/result evidence establish its participation. C and D have different hardware; both advertise the same model digest. C's buyer and general seller share one machine and can contend for inference capacity. Report that contention rather than pausing C's worker.

No fixed latency improvement is promised. A small bundle may be faster locally because discovery, planning, payments and polling cost time. HumanEval is a known public dataset, so memorization is possible. This first run establishes feasibility, not broad model capability or production throughput.

## Cost

Report marketplace buyer charges separately as **Stripe TEST cents**. They are simulated transfers, not measured infrastructure cost or actual dollars paid. Record local controller token counts and worker/judge usage when available. Energy and hardware amortization remain `null` unless measured; local inference is not declared free. No closed-source inference is used in this pair. A later closed-source arm must use the same frozen tasks, answer format, hidden tests and deadline, while recording actual token usage and dated provider prices.

## Run

From the repository root, with the existing C buyer state and Qwen3 8B installed:

```sh
pnpm --filter @atm/agent-daemon typecheck
pnpm --filter @atm/agent-daemon exec vitest run test/buyer-agent.test.ts
node --test scripts/autonomous-benchmark/grade.test.mjs
pnpm exec tsx scripts/autonomous-benchmark/run.ts preflight
pnpm exec tsx scripts/autonomous-benchmark/run.ts run autonomous-v2
```

On this Mac the grader uses `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`; `BENCHMARK_PYTHON` can select another working Python framework. macOS sandbox initialization requires running outside Codex's outer process sandbox, while generated code still runs inside the grader's restrictive sandbox. The launcher refuses to overwrite an existing protocol. Preserve failed runs and explain any later protocol revision.
