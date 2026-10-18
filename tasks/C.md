# Computer C — seller runtime and the Wasm sandbox

## Current handoff (2026-10-17, 19:58 PDT)

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
