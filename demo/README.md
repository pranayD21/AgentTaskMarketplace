# Live demo (under 3 minutes)

Owner: **E**. Rehearse with A at 07:00. Every command below runs from the repo root; `bash demo/run.sh <step>` wraps them.

## Before the audience arrives (T-15 min)

```sh
bash demo/run.sh check        # env keys set, qwen3:8b present, wassette 0.8, runner.wasm sha, /health ok
pnpm build:runner             # only if runner.wasm is missing or stale
bash demo/run.sh fresh        # frees the Inkbox free-tier slots, forgets local buyer/seller ids
```

Inkbox free tier = **3 identities**: `atm-marketplace` (the sender of every notice), one buyer, one seller. Judges deliberately get no identity. `fresh` deletes old `atm-buyer-*` / `atm-seller-*` identities so tonight's buyer and seller get the slots; run it **once** before rehearsal and once before the real demo.

Terminals (left to right): **T1** server (skip if using the hosted Manufact URL from A: set `MARKETPLACE_URL` in `.env`), **T2** seller, **T3** judge, **T4** buyer / Claude Code.

```sh
bash demo/run.sh server       # T1
bash demo/run.sh seller       # T2 (SELLER_RUNTIME=node until C's run-cycle lands; see Fallback)
bash demo/run.sh judge        # T3
```

Browser tabs: dashboard (B), Stripe **test** dashboard → Payments, Inkbox console → Agents → `atm-marketplace` → A2A.

## The script

| # | say | do | the audience sees |
|---|---|---|---|
| 1 | "Agents need compute they don't have. This is a marketplace where agents rent idle Macs from other agents." | Show dashboard, Stripe, Inkbox tabs. | Empty-ish dashboard; three Inkbox identities. |
| 2 | "Claude Code is the buyer. It discovers the marketplace over MCP." | In Claude Code (T4): *"Use the atm marketplace: call marketplace_info, then post a task asking for the capital of France, expect Paris, qwen3:8b, max 100 cents."* Fallback: `bash demo/run.sh happy`. | `post_task` → `OPEN`, `payment.state: HELD`; Stripe shows an uncaptured 1.00 USD **test** payment. |
| 3 | "A seller Mac claims it. The task is decrypted only inside a WebAssembly sandbox, with a key born in the sandbox." | Point at T2. | `claimed task_… model=qwen3:8b`, `[wassette] loaded … network allow-list: localhost:11434`, `submitted result_… commitment …`. Inkbox: `[assignment]` and `[submitted]` in the seller thread. |
| 4 | "The judge also runs in a sandbox. One call: it pulls the encrypted package, checks the commitment, grades, and submits. The host only sees the verdict." | Point at T3. | `[judge] APPROVE task_…: RUBRIC_MATCH (score 1) … captured 75c of the 100c hold`. Stripe: payment captured 0.75. Inkbox: `[verdict]` in seller and buyer threads. |
| 5 | "The buyer reads the answer and verifies it." | `bash demo/run.sh result <task_id>` (or ask Claude Code to `get_result`). | `answer: "Paris"`, `commitment_verified: true`, settlement `STRIPE_TEST`. |
| 6 | "What if a seller cheats or is just wrong?" | `bash demo/run.sh reject`, then `result <task_id>`. | T3: `REJECT … RUBRIC_MISMATCH … seller SUSPENDED … hold … cancelled`; buyer gets `replacement_answer` produced by the judge; T2's next claim → `SELLER_SUSPENDED`. Stripe: hold cancelled. |
| 7 | "The sandbox is deny-by-default." | `bash demo/run.sh denied` | `[wassette] … HTTP request blocked by network policy uri=http://localhost:3000/mcp allowed_hosts={… api.anthropic.com}`. |
| 8 | Honesty slide (below). | — | — |

Step 6 suspends the seller (`SUSPEND_AFTER_STRIKES=1`). To run the happy path again afterwards, `rm .atm-state/seller.json` and restart T2 (a new seller has no Inkbox slot left unless you run `fresh`).

## Honesty slide (say it plainly)

- The sandbox is **Wasmtime under Wassette**, deny-by-default network/env. It is **not a TEE**: the seller's OS can read the instance's memory and Ollama sees prompt tokens. A GPU TEE would close that gap.
- **No remote attestation.** The runner hash and model digests are self-reported.
- **Stripe test mode** only. Seller payouts stay `PENDING_ONBOARDING` until Accounts v2 onboarding completes.
- The judge is a quality signal (Claude, low effort), not proof; one strike suspends only to show the mechanism.

## Fallback plan

| failure | do |
|---|---|
| Seller Wassette path not ready (C's `run-cycle`) | `SELLER_RUNTIME=node bash demo/run.sh seller`. The log says `runtime=node-unsandboxed (UNSANDBOXED …)`; say so. The judge stays in Wassette. |
| Judge Wassette fails | `pnpm daemon --role judge --runtime node` (same `judge-cycle` code, unsandboxed, labelled). |
| Hosted Manufact server down | Local server (T1) and `MARKETPLACE_URL=http://localhost:3000/mcp`. |
| A teammate's judge grabs the task first | Expected on the shared Insforge DB; stop other judges before the demo. |
| Inkbox slow / quota | Notices are fire-and-forget (5 s timeout); the flow never waits on Inkbox. Show the earlier thread in the console. |
| Anthropic slow | Use `contains_text` tasks (steps 2 and 6 already do); `JUDGE_MODEL` overrides the model. |

## Verified on E's machine (2026-10-18 UTC, local server, shared Insforge, Stripe test)

- Judge in Wassette, `judge-cycle`: `APPROVE … RUBRIC_MATCH`, `APPROVE … LLM_RUBRIC_PASS (score 1)` (Anthropic reached from inside the sandbox), `REJECT … RUBRIC_MISMATCH … seller SUSPENDED … hold cancelled` with judge `replacement_answer: "4"`.
- Denied: `HTTP request blocked by network policy uri=http://localhost:3000/mcp`.
- Inkbox: identities `atm-marketplace`, `atm-buyer-…`, `atm-seller-…`; seller thread `[assignment] → [submitted] → [verdict]`; buyer thread `[verdict]`.
- `submit_verdict` twice → `idempotent: true`.
