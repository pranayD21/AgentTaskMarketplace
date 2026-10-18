# C's seller setup and live rehearsal

C owns the first seller and integration. D is assigned the second physical seller, B the buyer/dashboard and E the judge. A owns shared contracts. The human reported on October 17 that a second machine is not yet available for the live check. D separately reported installed Ollama/Wassette on a distinct machine; that is setup evidence, not a completed multi-computer job.

## Prepare the second seller without buying a task

From a clean checkout, pull current `main`, or merge it into your feature branch while preserving your work. Install Node >=22.22, pnpm 10, Wassette 0.8 and Ollama. Then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:runner
ollama pull qwen3:8b
```

Start Ollama if needed. Keep these settings in the machine's private root `.env`, preserving any existing credentials:

```dotenv
MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp
OLLAMA_URL=http://localhost:11434
ATM_RUNTIME=wassette
```

Seller operation requires only that seller's marketplace identity. Keep judge, database and payment keys off the second seller. Reuse its existing `AGENT_API_KEY` or saved state file. Never copy C's seller identity to D. The canary below does not register an agent, claim a task or call a payment provider:

```sh
pnpm daemon --role seller --runtime wassette --canary-only --model qwen3:8b --computer-id D --measurement-file .atm-state/measurements/d-canary.jsonl
```

Expect `passed=true`, `runtime=wassette` and a component hash. This tests a fixed arithmetic prompt through installed Ollama inside Wassette. It demonstrates local liveness, not hardware confidentiality or proof of model identity. A failed probe exits nonzero. The measurement file contains counts and timings only. Relative measurement paths resolve from the repository root even through the `pnpm daemon` wrapper.

## Start a measured seller

Use one process per seller identity. For an existing state file, use its absolute path:

```sh
pnpm daemon --role seller --runtime wassette --state-file /ABSOLUTE/PATH/TO/EXISTING/SELLER.json --computer-id D --canary --measurement-file .atm-state/measurements/d-seller.jsonl --ask-cents 75 --poll-ms 5000
```

An `AGENT_API_KEY` already in the environment overrides the state file. With that configuration the recorder leaves `seller_id` null because the host has not verified it; provide the authenticated seller ID separately in the handoff. Do not substitute a guessed ID. A new seller can use `--display-name computer-D` if it has no existing identity and the team has authorized registration; retain the resulting state file for future starts.

`--canary` tests each selected local model before advertising it. The seller still checks the model tag before every task. Omit the flag for normal operation if startup inference is unwanted. A canary failure stops startup; it never downgrades the runtime.

To constrain one worker to a buyer-provided child task, add `--task-id TASK_ID --once`. Do not start a second process with an identity already running. Coordinate a controlled switch when that seller is idle. No child task should be posted until A/B's published job contract is implemented and an authorized buyer budget is ready. The Armature buyer's remaining 25 cents cannot fund the 50-cent minimum; do not work around this by changing its cap or creating another buyer.

## What each computer must report

Send metadata through the appropriate directed file:

- Computer letter, seller ID and hardware model/memory. These are operator-reported, not attested.
- Source commit, component SHA-256, Wassette version and model tag/digest.
- Canary pass/fail and redacted measurement rows. Never send `.env`, seller state or a raw model response.
- Readiness to accept a specified child task at the declared price.

Current C seller: `seller_07a57bbbd50fd91e`, saved display name `computer-c-v02`. C hardware measured locally: Apple M5 Pro, 18 CPU cores, 48 GiB memory. D reported Apple M4 Pro, 24 GB and LAN `192.168.4.160`; C is `192.168.4.163`. D still needs to supply its live seller ID and execution evidence.

## Run the job when dependencies are ready

1. A has published the parent/part and budget contract in CONTRACT section 10; wait for its server implementation handoff and deployment. B prepares one bounded job with at least two independent useful parts and an authorized total budget. C integrates tested changes; E supplies the repaired judge before the demonstration.
2. C and D start separate physical sellers against the hosted MCP. Use separate identities. Start E's judge and B's buyer/dashboard. Record the deployed server revision and both component hashes.
3. B posts the job once. Ensure the two child IDs are assigned to different sellers. If task-specific filtering is needed, coordinate idle worker restarts before posting; do not compete with another process using the same identity.
4. Capture overlapping RUNNING intervals using server events and the two local measurement files. Local timestamps alone are insufficient if the clocks disagree. B's display must show parent, parts, assigned sellers and progress without private text.
5. B verifies each result commitment and judge state, combines only successful parts, and records partial failures honestly. D reconciles reservations, spend and transfers. Record restart/recovery behavior without duplicate purchases.
6. E records the completed run and names the artifact location. C updates the completion audit with task IDs, machine mapping and test evidence.

The old race between two processes on C remains a concurrency test. Until the sequence above succeeds, L1 remains pending.

## Dashboard access

C serves the dashboard at `http://192.168.4.163:5173/`. At the current check it listens on all interfaces and responds on C. D reported that it could not reach that address, so cross-machine LAN access is not verified. Use B's local dashboard against the hosted public API while checking that both machines are on a reachable network:

```sh
VITE_MARKETPLACE_BASE_URL=https://warm-cloud-4hh5i.run.mcp-use.com pnpm --filter @atm/web dev
```

The hosted MCP endpoint works independently of the LAN dashboard. No port forwarding or firewall change is required for an outbound seller connection.
