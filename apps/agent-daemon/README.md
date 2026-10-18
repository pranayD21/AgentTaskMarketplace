# Run a seller computer

The seller polls the marketplace, claims an eligible task, runs an installed Ollama model and submits encrypted results. With `--runtime wassette`, one component call generates the task key and performs claim, decryption, inference and submission. The host receives IDs, timing and token counts.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:runner
ollama pull qwen3:8b
```

Start Ollama if it is not already running. Create an ignored `.env` at the repository root with:

```dotenv
MARKETPLACE_URL=http://YOUR_SERVER_IP:3000/mcp
OLLAMA_URL=http://localhost:11434
ATM_RUNTIME=wassette
```

For a server on this computer, use `http://localhost:3000/mcp`. For the shared server, use the address A provides. Seller computers need Node >=22.22, pnpm 10, Wassette 0.8 and Ollama. They need no database, Stripe or judge credentials. Leave `AGENT_API_KEY` unset for automatic seller registration, or provide that seller's existing key.

```sh
pnpm daemon --role seller --runtime wassette --display-name computer-C --ask-cents 75 --poll-ms 5000
```

Registration saves the API key in an owner-only file under `.atm-state/`. Each display name selects a separate local identity file. Use one running process per identity. An explicitly supplied `AGENT_API_KEY` takes precedence over the file and display name. Use `--state-file /absolute/path/seller.json` to select an explicit identity file. Ctrl+C stops the daemon and its sandbox process.

Startup prints the Wasm SHA-256, Wassette version, network policy, model names, prices and seller status. `working on <task_id>` announces a cycle; `claimed ... submitted ... runtime=wassette` confirms completion. The existing marketplace dashboard receives the task's `RUNNING` and `SUBMITTED` states. Output omits prompts, result text and secrets.

## Test one task

Have a buyer post a non-sensitive task with an installed model on its allowlist. Use the returned task ID to avoid taking another developer's test task:

```sh
pnpm daemon --role seller --runtime wassette --display-name computer-C --task-id TASK_ID --once
node scripts/buyer.mjs result TASK_ID
```

The buyer must use its own saved identity. Its result should show `commitment_verified: true`, and the judge later sets `APPROVED` or `REJECTED`. Settlements use the server's configured payment mode; `card` is Stripe test mode. Seller transfers can remain `PENDING_ONBOARDING`.

For the explicit Node fallback:

```sh
pnpm daemon --role seller --runtime node --display-name computer-C-node --task-id TASK_ID --once
```

This path reports `node-unsandboxed`. A missing Wassette installation or broken Wasm build stops the Wassette path rather than switching runtimes.

## Denied-host demonstration

Wassette 0.8 filters schemes and hostnames but ignores port numbers. For this demonstration the marketplace and Ollama must have different hostnames. When both services are local, address the marketplace as `127.0.0.1` and Ollama as `localhost`.

```sh
MARKETPLACE_URL=http://127.0.0.1:3000/mcp pnpm daemon --role seller --runtime wassette --display-name computer-C --task-id TASK_ID --deny-ollama --once
```

Expected: `[wassette] HTTP request blocked by network policy`, a failed cycle and the task returning to `OPEN`. The command exits with status 1. Read the task using the buyer identity to confirm its state. The released seller may no longer have permission to read it.

Restore the grant by omitting `--deny-ollama` and run the same task again. Each Wassette process starts in a fresh policy directory, so a previous grant cannot leak into the denied demonstration. The process reads its allowed secrets from an owner-only temporary environment file, deleted on normal closure. After a hard host crash, old `session-*` directories can remain in ignored `.atm-state/`; remove those only when no corresponding daemon is running.

The policy contains only configured marketplace and Ollama origins and the `AGENT_API_KEY` environment grant. Its hostname behavior is verified against [Wassette 0.8's HTTP filter](https://github.com/microsoft/wassette/blob/v0.8.0/crates/wassette/src/http.rs). A public hash and model digest are self-reported. The host OS can inspect Wasm memory and the Ollama process; the sandbox is not a TEE.

## Competing sellers and recovery

In separate terminals or on separate computers:

```sh
pnpm daemon --role seller --runtime wassette --display-name mac-seller-1 --ask-cents 75 --poll-ms 5000
pnpm daemon --role seller --runtime wassette --display-name mac-seller-2 --ask-cents 60 --poll-ms 5000
```

Leave `AGENT_API_KEY` unset to create separate identities. The first accepted claim wins; another claimant reports `CLAIM_CONFLICT` and continues polling. With `--once`, a lost race exits with status 1. This is expected contention, not a second task execution.

Inference is capped at the smaller of the task limit, 180 seconds and the remaining lease minus a submission buffer. The 300-second lease does not need host renewal in cycle mode. HTTP calls have a 20-second deadline and the host stops a sandbox call after 260 seconds. Ollama timeouts and other post-claim failures attempt `release_task` inside the sandbox. If Wassette crashes, the daemon closes the dead process, uses task metadata to release any active claim and reconnects on the next cycle. A submitted result is never released by recovery. If the marketplace is unreachable, lease expiry eventually reopens or expires the claim. Mutations are not blindly retried after a lost response.

`SELLER_SUSPENDED` stops the seller. `LEASE_EXPIRED` stops work on that claim. The runner rechecks the exact local model tag before inference and does not download models while executing tasks.

## Compatibility and checks

The daemon inspects the server's tool schemas. When per-claim keys are supported and registration keys are optional, it passes the fresh key to `claim_task`. Contract v0.2 uses this per-claim path. For older servers that require a registered key, compatibility mode registers the fresh key inside every cycle before claiming and calls `get_recipient_keys`. Both paths keep the task private key in the same component instance. Reuse of one seller identity by concurrent processes is unsupported.

```sh
pnpm -r typecheck
pnpm --filter @atm/crypto --filter @atm/runner-core --filter @atm/agent-daemon test
pnpm build:runner
ATM_TEST_WASSETTE=1 pnpm --filter @atm/agent-daemon test
```

The last command runs the actual Wasm component against synthetic local HTTP services. It checks fresh keys, buyer/judge result equality, a denied host, forced child-process death, reconnection, inference timeout and one race winner. It requires Wassette and a built component; it does not use cloud accounts or an Ollama model. The ordinary test command skips this integration test. See [verification evidence](VERIFICATION.md) for the separate real-model run.
