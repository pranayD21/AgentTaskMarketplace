# Computer C verification

## Combined A/C build, October 17, 20:52 PDT

The human assigned both A and C work to this computer. Task offers, parent jobs, E's review/replacement loop and D's checked transfer reconciliation are integrated. A/C added transactional task/budget creation before holds, durable post recovery, payout leases with stable retry keys, balance revisions and deterministic verdict ids. The seller UI compatibility edit removes its ask quote.

Verification: workspace typecheck; 201 tests (crypto 7, web 17, core 49, daemon 22 including real Wassette, server 106); smoke APPROVED twice at 100c per task, commitment verification, reserved 0c/spent 200c MOCK. Component SHA-256 `a3662f2c2b4358d213c22923683e98f2579e7789e04df2eba7632ee898360e34`. The additive schema was applied to Insforge; `node scripts/verify-postgres-posting.mjs` passed the actual atomic posting function and removed its synthetic fixtures. Insforge disallows transaction-control statements, so the check uses exact fixture cleanup instead of a rollback wrapper. No payment calls in that verification.

D's idempotent hold/error metadata and per-payment MPP reservation fix are integrated. Hosted health at 04:04:05 UTC verified source `920c052`, contract 0.3 and task-offer pricing. C's general seller and judge are running with existing identities. B's grouped job UI and physical C/D execution are not yet verified. Historical evidence below retains its original scope.

## C follow-up status, October 17, 20:37 PDT

- D is available and replied READY in `D-C-20261018T033115Z-01`. D passed the measured Wassette canary. C independently read the hosted dashboard and confirmed D seller `seller_0213ff3d1ffc3278` is ACTIVE and its standalone task `task_1197eab50f2c0367` is APPROVED. The shared parent job with overlapping C/D execution remains pending A/B implementation and deployment.
- C measurements, optional job/part identifiers and the liveness canary are on main at `c0099ef` and its integration commits. The final component from that slice passed the real qwen3:8b canary at 03:26:12 UTC (2327 ms). A canary is operational evidence only.
- A server slice `9622d2d`, E worker/Inkbox slice `6c32e46` and B benchmark/disconnect slice `d9604ae` are integrated. C resolved the A/E type mismatch by importing A's canonical public reason table in the judge and Inkbox. Workspace typecheck, 130 ordinary tests, all 15 daemon tests with actual Wassette, the 3 benchmark tests and smoke passed. There are 132 unique workspace tests when the two optional Wassette cases are included. Current combined component SHA-256 is `5f82c3e1e05b04dae5facd66d3cac719c58b4b56da2ec84f4fb2f179c8e62294`. This server slice is not yet deployed.
- C ran B's `atm-bounded-v1` direct-local warm arm: 12 requests completed, 6 strict quality passes, no retries; p50 587 ms, p95 737 ms. All failures remain in the evidence. The 12 usage rows validate against A's `UsageRecord`. No external model or payment call occurred. Energy and total system cost are unknown. The local arm alone cannot establish savings.
- C's task-offer client is tested and pushed at `feat/c-task-pricing` / `2e74276`: no seller quote, advertised-offer selection, and price verification before inference. It is held off main until A publishes the matching pricing contract/server. A owns task pricing and market observations; B owns buyer/UI changes; D payment assertions; E demo wording. No equilibrium has been measured.
- D's payment-provider handoff needs the transfer-identity/amount checks reported in C-to-D. A/D must also reconcile retry attempt keys and durable retry ownership. A's parent/part implementation, hosted migration/deployment and the joint physical run are still open. E's newer overlap script needs claim-attempt/RUNNING interval review before it can prove simultaneous execution.

Evidence: [local arm](evidence/bounded-v1-local-warm.json), [usage rows](evidence/bounded-v1-local-warm.json.usage.jsonl), [C's isolated disconnect run](evidence/disconnect-c-20261018.json). The earlier entries below retain their original timestamps and limitations.

## Task-offer client, awaiting server deployment

C changed the seller to advertise capabilities without ask prices, require the server's `pricing.mode = "task_offer"` capability, prioritize valid posted offers, and check the claim price before inference. Existing `--ask-cents` launch arguments are ignored with a migration notice. A owns the shared contract/server and B the buyer UI; this client slice alone does not change the hosted server.

Workspace typecheck passed. Runner-core passed 27 tests, and `ATM_TEST_WASSETTE=1 pnpm --filter @atm/agent-daemon test` passed all 22 daemon tests. Both Node and actual Wassette tests prove that a changed-price claim is released before model execution. Component SHA-256: `03b17dc131c754817446167277e5dbc8402890b4b1234e0b0abad6a8b48b45db`. The full task-offer smoke/deployment check is pending A's server slice. No new marketplace task or paid API call was made for these checks.

## C runtime follow-up, October 17, 2026, 20:22 PDT

B's PR #3 at `39eaa4e` was reviewed and integrated; its buyer recovery/docs passed typecheck, 82 tests and smoke before publication. C then added local per-attempt measurement files, a fixed model canary and an `atm.usage.v1` exporter. A's v0.3 contract is adopted for optional job/part metadata; live job server support is still pending.

- `pnpm -r typecheck && ATM_TEST_WASSETTE=1 pnpm test && pnpm smoke` passed on the C feature tree: **97 tests** (crypto 7, web 17, runner-core 25, daemon 15, server 33). No Wassette skip in this run. Smoke uses fake Ollama, memory storage and mock payments.
- `pnpm build:runner` passed. Component SHA-256: `de3bec10035c1d1f077204fb5a36458e3c34514ebd4f1f75afb24bb67b182a72`.
- Real Wassette tests include fresh keys, denial, a killed child, reconnection, timeout, a race, retaining inference usage after submission failure and a canary making no marketplace calls.
- An earlier build of the same canary passed on C's installed qwen3:8b at 03:16:23 UTC. It reported 58 input tokens, 2 output tokens, 5376 ms runner time, including 5199.558291 ms model loading. Hardware: Apple M5 Pro, 18 cores, 48 GiB; model digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. This single synthetic probe is not a benchmark comparison. Energy was not measured.
- Hosted health returned 200, contract 0.2/card/Insforge. C's dashboard listens on all interfaces and returned 200 locally. D reported LAN access failure; cross-machine dashboard access remains unverified.
- The human reported that a second machine is not yet available for the live check. D separately reported installed tooling on a distinct M4 Pro machine; no child-task execution evidence has been supplied. The physical multi-computer job remains pending.

See [the setup guide](MULTI-COMPUTER.md) and [measurement format](MEASUREMENTS.md). Current C seller is `seller_07a57bbbd50fd91e`. Existing identities, buyer caps and shared Inkbox identities were preserved. The original verification below is historical.

Verified on October 18, 2026, 01:44–01:55 UTC, with Node 26, Wassette 0.8, local Ollama and qwen3:8b. The live marketplace used the supplied Insforge project and Stripe test mode. The two sellers ran as separate local processes with separate identities. This does not establish connectivity between physical computers.

Final component SHA-256:

```text
88f3899040f12be10ca3bfc3c6f924407223234cf98b7767aca37623bb320e4f
```

`pnpm -r typecheck` passed. `pnpm build:runner` compiled the component and printed the hash above. `ATM_TEST_WASSETTE=1 pnpm --filter @atm/crypto --filter @atm/runner-core --filter @atm/agent-daemon test` passed 26 tests: 6 crypto, 13 runner-core and 7 daemon tests. The daemon suite includes a real Wassette process, local fixture HTTP servers, a forced child-process kill and a delayed model response.

The unfiltered `pnpm test` already failed before this work because `apps/marketplace-mcp` runs `vitest run` with no test files. C left that A-owned package unchanged and reported the gate to A.

## Live results

The buyer's `get_result` returned `commitment_verified: true` and an exact match to the synthetic expected answer for all five tasks below. The judge approved each, and `payment.state` became `CAPTURED`. Amounts are Stripe test cents; this is not evidence of a completed real seller transfer.

| Check | Task | Result | Payout recorded |
| --- | --- | --- | --- |
| Explicit Node fallback | `task_ef063a0f2999f12e` | `result_694ffa2841c1ff92` | 75c |
| Single-call Wassette runner | `task_44d1688c561904db` | `result_12214d292860deca` | 75c |
| Denied host, then restored grant | `task_b4044911fcc627bf` | `result_96d3ea56f4015e49` | 75c |
| Two live seller processes racing | `task_132de0acf4f6b5be` | `result_30ab643f86a421a8` | 60c |
| Final component build | `task_e66ebe94dff17966` | `result_b039ca308c8ceea1` | 75c |

The final build ran with:

```sh
pnpm daemon --role seller --runtime wassette --display-name computer-c-wasm-check --task-id task_e66ebe94dff17966 --once
```

Relevant output:

```text
claimed task_e66ebe94dff17966 (claim_13c53aff5715122b); submitted result_b039ca308c8ceea1 in 183ms (2 tokens); key=runner-db15864597c547f9; runtime=wassette
```

This short, warm-model run demonstrates execution, not a latency benchmark.

## Denial and race

```sh
MARKETPLACE_URL=http://127.0.0.1:3000/mcp pnpm daemon --role seller --runtime wassette --display-name computer-c-wasm-check --task-id task_b4044911fcc627bf --deny-ollama --once
```

The process printed the Wassette policy refusal below and exited 1. The buyer then read the task as `OPEN`. Repeating without `--deny-ollama` submitted the result in the table.

```text
[wassette] HTTP request blocked by network policy (configured origins: http://127.0.0.1:3000)
```

Two commands started together against the same task:

```sh
pnpm daemon --role seller --runtime wassette --display-name computer-c-wasm-check --task-id task_132de0acf4f6b5be --once
pnpm daemon --role seller --runtime wassette --display-name mac-seller-2 --ask-cents 60 --task-id task_132de0acf4f6b5be --once
```

`mac-seller-2` won `claim_4b2ad1773881538d` and submitted `result_30ab643f86a421a8`. The first seller printed `CLAIM_CONFLICT` and exited 1. Exactly one submitted result was observed.

## Findings and integration notes

- The former `get-public-key` / `run-task` decryption failure is fixed for the seller by `run-cycle`, which retains its key throughout one component invocation.
- The live server still requires registered keys. The verified compatibility path registers a fresh public key from inside the component before claiming. Per-claim keys and optional registration keys remain A's proposed API change. The daemon detects that future capability from tool schemas; that path passed the local fixture tests.
- Wassette 0.8's network filter ignores ports. Bare `localhost:port` is also parsed as a URL scheme. Complete origins fix the parsing issue; the documented effective restriction remains scheme plus hostname. The denied-host demo must use different hostnames.
- The Wasm fetch implementation ignored `AbortSignal` in a delayed-response test. An explicit timer race and elapsed-time check now prevent late model output from being submitted. The forced timeout test confirms task release.
- A killed Wassette child causes host recovery of the active claim; a subsequent cycle creates a fresh process and succeeds. A result already submitted is not released after an ambiguous transport failure. Failed calls return codes without private text.
- No shared API/schema, payment implementation or judge algorithm was changed. E can reuse `FetchMarketplace` and the seller's grant setup for `judge-cycle`. The optional model canary was not added.
