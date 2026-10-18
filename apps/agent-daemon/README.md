# Run a seller computer

New C follow-up: [multi-computer setup and rehearsal](MULTI-COMPUTER.md), [measurement fields and cost limits](MEASUREMENTS.md). Use `--canary-only` for a local Wassette model probe without agent registration or a marketplace purchase. Use `--canary` and `--measurement-file` to record liveness and per-attempt usage on a seller.

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
pnpm daemon --role seller --runtime wassette --display-name computer-C --poll-ms 5000
```

Registration saves the API key in an owner-only file under `.atm-state/`. Each display name selects a separate local identity file. Use one running process per identity. An explicitly supplied `AGENT_API_KEY` takes precedence over the file and display name. Use `--state-file /absolute/path/seller.json` to select an explicit identity file. Ctrl+C stops the daemon and its sandbox process.

Startup prints the Wasm SHA-256, Wassette version, network policy, model names, task-pricing mode and seller status. `accepting <task_id> offer=<cents>` announces a cycle; `claimed ... submitted ... runtime=wassette` confirms completion. The existing marketplace dashboard receives the task's `RUNNING` and `SUBMITTED` states. Output omits prompts, result text and secrets.

## Install the seller dashboard

On an Apple silicon Mac:

```sh
curl -fsSL https://warm-cloud-4hh5i.run.mcp-use.com/install.sh | bash
```

The installer prepares Homebrew, Node, pnpm, Ollama and Wassette, downloads a checksummed bundle and prebuilt Wasm runner, and opens a local dashboard. A fresh Mac may ask for its administrator password or developer-tool approval during Homebrew setup. The private GitHub repository is not needed.

In the dashboard:

1. Sign in with Google. InsForge creates or reuses your human identity; the marketplace links this computer's seller to that identity.
2. Prepare the model. The app detects supported Ollama models, downloads Qwen3 8B if needed, and checks model liveness through Wassette.
3. Set up Stripe payouts. Complete Stripe Connect's hosted form for this seller. All payments currently use **Stripe TEST MODE**. The installer supplies no fake personal details. An active transfer capability does not prove a real bank payout.
4. Click **Start selling**. The worker watches for matching tasks. It restarts after login; clicking Stop selling keeps it stopped across logins until you start it again.

The dashboard runs at `http://127.0.0.1:43118`. Use `atm-seller dashboard` to open an authenticated local session. It shows CPU cores, system load, total/free physical memory, installed models, models loaded in Ollama, seller status and approved task count. Hardware measurements stay local; model capability metadata goes to the marketplace. Model detection and the liveness check are not attestation.

```sh
atm-seller dashboard
atm-seller status
atm-seller logs
atm-seller stop
atm-seller start
atm-seller uninstall
```

State is stored in `~/.atm` with private permissions. The seller key is in `seller.json`; the browser never receives it. OAuth uses PKCE, and Google access/refresh tokens are not saved to disk. Repeating installation or sign-in reuses the saved seller. Uninstall removes software and login services while preserving identity, logs and Ollama models.

The server checks Google ownership and requires Stripe readiness for new human-owned sellers to claim work. Existing C/D workers retain their identities and keep running. Old anonymous registration instructions below apply to isolated memory/mock development or existing saved identities; new hosted sellers must use this dashboard.

### Recovery

If sign-in is cancelled, retry Continue with Google. If model setup fails, inspect `atm-seller logs`, resolve the issue and retry Prepare model. If Stripe's link expires, return to the dashboard and click Set up Stripe again. A payout-account request uses one stable idempotency key and at most three attempts, with five-second backoff, within 20 hours. An unresolved request after that requires operator reconciliation; creating another seller is not the recovery path.

The release contains no repository access token, server/database/Stripe credential or judge key. The installed worker checks the public contract and runner checksum before claiming. Update with the same installer command when prompted.

## Task prices

The buyer posts an offer on each task. This seller advertises installed models and accepts a task offer by claiming it. When several eligible tasks are open, it prefers the highest offer and retains server order for ties. `--task-id` restricts it to the assigned task. It checks the agreed price before inference and releases a claim if the server returns a different amount.

The server must advertise `marketplace_info.pricing.mode = "task_offer"`. An older server stops startup before agent registration; upgrade the server first. Rebuild the Wasm component after pulling this change. The deprecated `--ask-cents` flag is ignored with a notice, so old launch scripts cannot set payment. No seller quote is sent.

Higher offers receive priority from this worker. That is one mechanism for buyers to compete for available capacity. Market observations and recommendations belong to the server; this worker does not estimate an equilibrium or change a buyer's offer.

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
pnpm daemon --role seller --runtime wassette --display-name mac-seller-1 --poll-ms 5000
pnpm daemon --role seller --runtime wassette --display-name mac-seller-2 --poll-ms 5000
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
