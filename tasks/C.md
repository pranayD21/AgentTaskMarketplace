# Computer C — seller runtime and the Wasm sandbox

## Current C handoff, October 17, 21:05 PDT

Task pricing, usage capture, safe job/part correlation, the local model canary and the direct-local benchmark arm are delivered. A/C code and tested B/D/E slices are merged; hosted source `920c052` reports contract 0.3 and task-offer pricing. The final workspace run passed typecheck and 201 tests including actual Wassette. Component SHA-256: `a3662f2c2b4358d213c22923683e98f2579e7789e04df2eba7632ee898360e34`.

The human requested that C's general worker stay running. It resumed at 04:03 UTC as existing seller `seller_07a57bbbd50fd91e`, with task-offer pricing, Wassette and 5000 ms polling. C's existing judge `judge_00b762de5b57f6fa` resumed with the updated component at 04:04 UTC. Preserve both identities. D has been asked to start its general worker before a two-part 120c rehearsal; the C/D execution overlap is still unverified. Do not pause C for a pinned-part experiment.

B still owns automatic decomposition/aggregation, grouped UI and the full paired cost comparison. E owns final recording and Inkbox live evidence. See [C verification](../apps/agent-daemon/VERIFICATION.md) and [the current audit](../docs/COMPLETION-AUDIT.md); the older checklists below are history.

## Latest product change: price tasks (2026-10-17, 20:25 PDT)

The human has changed the product requirement: tasks carry a posted price; sellers do not set per-task compute prices. A seller accepts the task price by claiming it. Keep the accepted price fixed through settlement. Existing claimed tasks keep their agreed price. Future task prices should respond to market demand and completion evidence; do not claim market equilibrium before measuring it or raise buyer spending caps automatically.

Own seller runtime changes: advertise models/capabilities without a compute quote, discover task-pricing support, show the posted offer and accept it by claiming. Do not silently register a seller quote on an old server. Coordinate the contract through A, integrate tested owner slices and retain existing claimed prices. Measurement/canary work is committed at c0099ef; physical two-seller proof is still pending.

Read the newest inbound messages and C's outbound pricing proposal for the handoff. This section takes priority over historical seller ask-price instructions below.

## Completion audit: your next assignment (2026-10-17, 20:05 PDT)

The core marketplace is running, but the full original request is unfinished. This section takes priority over the historical build checklist below. The [completion audit](../docs/COMPLETION-AUDIT.md) gives evidence, assignment IDs and acceptance criteria. Fresh checks on `82d0aa2` passed workspace typecheck, 79 tests and smoke. Earlier real-Wassette and hosted purchase evidence remains valid. No cost benchmark or complete multi-computer job demonstration has been recorded.

Start by fetching the latest `origin/main` and bringing it into your existing feature branch without discarding local work. Read your four inbound files in `coordination/messages/`, then acknowledge this assignment to C in `<YOUR LETTER>-to-C.md` (C records its own progress in its outbound handoffs). C remains acting integrator under A's delegation. Send contract/schema requests to A; C coordinates merges. Do not edit another computer's implementation files without a recorded ownership decision.

Use `MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp` in your private environment. Application health is `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`; dashboard is `http://192.168.4.163:5173/` on C's LAN. Workers use `--poll-ms 5000`. Preserve the running service and existing identities. Do not reset shared Inkbox identities. The Armature buyer has 25 cents available, below the 50-cent new-task minimum; a new buyer or higher cap must not be used to bypass that limit. All current payment evidence is Stripe TEST mode.

### Your work, in order

1. **L1, lead:** coordinate a live run with B as buyer, C as first physical seller, D as second physical seller, E as judge and A supporting the hosted service. Help D install/pull the local model and build Wassette. If D lacks suitable hardware, record a reassignment to a capable A/E machine. Require two distinct physical seller computers; the previous two-process race does not satisfy this request.
2. **F1, seller support:** wait for A's parent/part/progress contract, then make seller execution report safe identifiers and state for B's grouped dashboard. Keep task contents private in all metadata/logs. Acceptance: the two physical sellers complete different parts of one job with overlapping execution, verified results and a truthful per-machine trace.
3. **B1, runtime measurements:** capture seller input/output tokens, inference/load time, hardware details and measured energy or a clearly labelled estimate. Include failed attempts and retries. Coordinate shared metric fields with A and output format with B/D. Existing output-token counts and one warm latency measurement are insufficient for cost claims.
4. **Integration for A:** first review and verify B's ready PR #3 at `39eaa4e` (buyer recovery guidance plus current evaluation docs; B reports 82 branch tests). Then collect A/E fixes for J1/J2/J3, A/D fixes for P1/P2, and E's I1/D1 handoff. Merge tested slices without modifying owner code silently. Run workspace typecheck/tests/smoke, rebuild Wasm after runtime changes and rerun actual Wassette cases. Record the deployed revision and health before rehearsal. Keep existing workers available; do not restart shared services just to audit them.
5. **X1, model/confidentiality scope:** implement the optional liveness canary or explicitly agree its deferral with A. Keep the installed-model check and report limitations. Help A plan attested confidential inference later; Wasm, a canary or a reported hash cannot establish privacy against the machine owner.
6. **D1, evidence:** record commit/component hash, machine-to-seller mapping, job/part IDs, overlapping timestamps, outcomes and balances. Give E redacted evidence for the final runbook/recording. Update the audit status only after checking those artifacts.

### Finish and hand off

Own seller paths in runner-core, runner-wasm and agent-daemon; E owns judge logic. Integration/docs work remains authorized by A's delegation. Send each affected computer a C-to-letter HANDOFF with assignment IDs, branch/SHA, tests and limits. For this audit, assignments are published but the physical machines have not been remotely started.

## Historical handoff (2026-10-17, 19:58 PDT)

The per-call key blocker is fixed. Both seller and judge ran in Wassette against the hosted server, with APPROVED, commitment_verified=true and per-claim keys. C is also acting integrator for A. Keep the seller and judge alive at 5000 ms polling, integrate tested handoffs, and use the current status in docs/PROGRESS.md instead of rebuilding the original fix.

Shared MCP endpoint: `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`. Application health: `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`. Public dashboard on C’s LAN: `http://192.168.4.163:5173`. Set `MARKETPLACE_URL` to the hosted endpoint in your private environment. Local agents need `--poll-ms 5000`. All payments are Stripe TEST mode.

Latest completed checks: 79 tests, workspace typecheck and smoke passed; the real-Wassette daemon suite passed 7/7. Three Armature cases passed 5/5 each: accepted purchase, cap rejection and simulated task-ID recovery. Pending-seller and rejected-result cases lack fixtures within the remaining 25-cent cap; see the report for the exact limits. Read your four incoming coordination files before starting; the original implementation checklist below records the build assignment and may describe work that is already complete. Deployment details are in `docs/DEPLOYMENT.md`; evidence is in `docs/PROGRESS.md` and `docs/ARMATURE-RESULTS.md`.

You are **C**. You own `packages/runner-wasm/**`, `packages/runner-core/**` (seller path; coordinate judge-path edits with E), and `apps/agent-daemon/**` (seller loop and both runtimes). The sandbox implementation is complete and verified; maintain the seller runtime and support the shared live demo.

## 0. Setup (15 min)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
git switch -c feat/c-seller origin/main
brew install ollama wassette && brew services start ollama && ollama pull qwen3:8b   # 5.2 GB
pnpm install && pnpm -r typecheck
pnpm build:runner                               # builds packages/runner-wasm/dist/runner.wasm (~20 MB) and prints its sha256
# .env from the human: MARKETPLACE_URL (A posts it), OLLAMA_URL, ATM_RUNTIME=wassette. Nothing else is needed for the seller.
pnpm daemon --role seller --runtime node --once    # proves the whole path with the UNSANDBOXED fallback
pnpm daemon --role seller --runtime wassette --once # runs one cycle; the old key-loss blocker is fixed
```

Read `docs/PROGRESS.md` §3 (runner-core, runner-wasm, agent-daemon), §5 findings (componentize-js/Wizer, Wassette), §6 issue 1; `docs/CONTRACT.md` §6–7; `docs/SECURITY.md`.

## 1. Runner-driven single call — target 21:30 (this is the fix)

Wassette creates a fresh component instance per tool call, so a keypair made in `get-public-key` is gone by `run-task`. Make one call do everything:

**Component (`packages/runner-wasm`):**
1. Add to `wit/world.wit`: `export run-cycle: func(opts: string) -> result<string, string>;`. `opts` JSON: `{ marketplace_url, model_id, ollama_url, task_id, max_runtime_s }`. Keep the three existing exports for debugging.
2. In `src/component.ts` + `packages/runner-core`: `runCycle(opts)`:
   - `restoreRandom()`, generate keypair (`generateKeypair`, `keyIdFor`).
   - Read `AGENT_API_KEY` via `wasi:config/store` `get` (host grants it; it is the seller's own identity).
   - Call the marketplace **from inside the sandbox** with `fetch` to `<marketplace_url>` using the MCP streamable-HTTP JSON-RPC shape (see `scripts/buyer.mjs` for a 20-line client: `initialize`, then `tools/call`, headers `accept: application/json, text/event-stream`, `authorization: Bearer …`, keep `mcp-session-id`). Call `claim_task` with `task_id`, `model_id`, `runner_pubkey_b64`, `runner_key_id` (contract v0.2 from A).
   - Decrypt `claim.seller_envelope`, run Ollama (`runTask` logic), seal to `buyer_public_key` and `judge_public_key` from the claim response, call `submit_result`.
   - Return `{ task_id, claim_id, result_id, runtime_ms, tokens_out, key_id }`. On any error after the claim, call `release_task` with a short reason and throw.
3. Policies / grants: seller network allow-list = Ollama + the marketplace. Pass full origins parsed from `MARKETPLACE_URL`; Wassette 0.8 enforces hostname grants and does not restrict ports. Grant `AGENT_API_KEY` through the private environment file used by `apps/agent-daemon/src/runtime/wassette.ts`.
4. Daemon seller loop: with `--runtime wassette`, the host does `list_open_tasks` (host-side, metadata only) and then calls `run-cycle` for the chosen task; it no longer calls `claim_task`/`submit_result` itself. Lease renewal: a 300 s lease covers a 180 s task; skip host renewal in cycle mode (document it).
5. `register_seller` in cycle mode: send models, `runtime: "wassette"`, `runner_wasm_sha256`, and **no** registered key (v0.2 makes it optional) or a placeholder; the per-claim key is what matters.

Until A ships v0.2 (`claim_task` accepting the per-claim key), develop against the current contract by registering the first cycle's key via `register_seller` — not needed once v0.2 lands. Message A immediately (`C-to-A`, `QUESTION`) confirming the field names in `docs/CONTRACT.md` §7.

**Watch for:** StarlingMonkey `fetch` POST with JSON body to a plain-http host (Ollama worked for GET-style probes in docs; verify POST). If `fetch` streaming/SSE breaks parsing of the MCP response, request `accept: application/json` only — the mcp-use server returns JSON when the client does not accept SSE. If componentize-js cannot do it, try `jco componentize --backend qjs`.

## 2. Sandbox demo material — target 23:00

- Denied-host demo: use the implemented `--deny-ollama --once` seller flag and capture the policy refusal. Use different hostnames for Ollama and the marketplace when testing locally, because Wassette 0.8 grants access by hostname. See `apps/agent-daemon/VERIFICATION.md` for the verified sequence.
- Print at startup: component sha256, Wassette version, the exact allow-list, and "the host never sees the task key".
- Model canary: after `register_seller`, run a tiny prompt through the sandbox and log tok/s (optional; `ModelInfo.tok_per_s`).

## 3. Robustness — target 00:30

- Two sellers racing: run a second daemon with `--display-name mac-seller-2 --ask-cents 60` (delete `.atm-state/seller.json` or set `AGENT_API_KEY` to a second key) and confirm exactly one wins (`CLAIM_CONFLICT` on the other).
- Clean handling of `SELLER_SUSPENDED` (stop), `LEASE_EXPIRED`, Ollama timeouts (release with reason), Wassette crash (reconnect).
- `--poll-ms 5000` against the hosted URL (Manufact bills per tool call).

## 4. Hand off to E

E's `judge-cycle` mirrors your `run-cycle` (fetch_review_package → judge → submit_verdict inside the sandbox). Post `HANDOFF` in `C-to-E` with your MCP-over-fetch helper's location and the grant pattern so E reuses it instead of rewriting.

## Verify and hand off

- `pnpm daemon --role seller --runtime wassette --once` → `claimed … submitted …` with `runtime=wassette`; `node scripts/buyer.mjs result <task_id>` shows the answer and `commitment_verified: true` after E's judge approves (or A's judge in node mode).
- Denied-host log captured. Race shows one winner.
- `HANDOFF` to A: branch, commit, commands, output, sha256 of `runner.wasm`, open gaps.
