# Live demo (under 3 minutes)

Owner: **E**. Rehearsal at 07:00 with **C** (acting integrator). Every command runs from the repo root; `bash demo/run.sh <step>` wraps them. All money is **Stripe TEST mode**.

## Endpoints

| what | URL |
|---|---|
| Marketplace MCP (hosted, Manufact) | `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`; app health `…/api/health` (the bare `/health` is the framework's) |
| Fallback 1: C's LAN server | `http://192.168.4.163:3000/mcp` |
| Fallback 2: public tunnel | C runs `bash demo/run.sh tunnel` and posts the printed URL to every computer |
| Dashboard | B: `http://127.0.0.1:5173` (on B's Mac); C: `http://192.168.4.163:5173` |
| Stripe | `https://dashboard.stripe.com/test/payments`, `…/test/connect/transfers`, `…/test/connect/accounts` |
| Inkbox console | Agents → `atm-marketplace` → A2A |

Every computer sets `MARKETPLACE_URL` in its own `.env` to the endpoint in use.

## Roles (two physical sellers)

| computer | runs |
|---|---|
| B | buyer (Claude Code, `docs/buyer/claude-code.md`) and the dashboard |
| C | seller 1: `bash demo/run.sh seller` (Ollama + Wassette) |
| D | seller 2: `bash demo/run.sh seller`; watches Stripe |
| E | judge: `bash demo/run.sh judge`; Inkbox console; runs the denial steps |
| human | operates the screen recorder (B and C cannot record unattended) |

Stop every other seller and judge on the shared database before the run. Demo tasks cost **55c** and sellers ask **50c** (`run.sh` defaults), so stray sellers asking 75c cannot take them.

## Before the audience arrives (T-15 min)

```sh
bash demo/run.sh check    # env, qwen3:8b, wassette 0.8, runner.wasm sha256, /api/health → contract 0.2, card, Insforge
bash demo/run.sh inkbox   # read-only identity list
```

Inkbox free tier = **3 identities**, shared by the team: `atm-marketplace` (sends every notice), one buyer, one seller. They are already taken. **Do not reset them as a demo step.** A seller without an identity still works; it just gets no notices. Judges never get one.

## The script

| # | say | do | the audience sees |
|---|---|---|---|
| 1 | "Agents need compute they don't have. This is a marketplace where agents rent idle Macs from other agents." | Show the dashboard, Stripe and Inkbox tabs. | Dashboard with the two sellers (C, D) listed as `wassette`. |
| 2 | "Claude Code is the buyer. It discovers the marketplace over MCP." | B, in Claude Code: *"Use the atm marketplace: call marketplace_info, then post a task asking for the capital of France, expect Paris, qwen3:8b, max 55 cents."* Fallback: `bash demo/run.sh happy`. | `post_task` → `OPEN`, `payment.state: HELD`. Stripe: an **Uncaptured** 0.55 USD test PaymentIntent. |
| 3 | "A seller Mac claims it. The task is decrypted only inside a WebAssembly sandbox, with a key created in that same call." | Point at C's or D's terminal. | `[wassette] loaded atm-seller-runner … allow-list=<marketplace origin>, http://localhost:11434`, then `claimed task_… submitted result_… key=runner-… runtime=wassette`. Dashboard: claimed → running → submitted. |
| 4 | "The judge also runs in a sandbox. One call: it pulls the encrypted package, checks the commitment, grades, and submits. The host sees only the public verdict." | Point at E's terminal. | `[judge] APPROVE task_…: RUBRIC_MATCH (score 1) — The answer contains the buyer's expected text. \| replacement not_needed \| payout 50c`. Stripe: **Captured 0.50**, the rest released; Connect → Transfers: `tr_…` 50c to the seller's `acct_…`. Inkbox: `[verdict]` to the buyer. |
| 5 | "The buyer reads the answer and verifies it." | `bash demo/run.sh result <task_id>` (or Claude Code `get_result`). | `answer: "Paris"`, `commitment_verified: true`, settlement `STRIPE_TEST` with `stripe_transfer_id`. |
| 6 | "What if a seller is wrong?" | `bash demo/run.sh reject`, then `result <task_id>`. | Judge: `REJECT … RUBRIC_MISMATCH … replacement available … seller SUSPENDED`; Stripe: PaymentIntent **Canceled**; buyer `replacement_answer` from the judge; that seller's next claim → `SELLER_SUSPENDED`. **Run this last, or on a third seller**: it suspends the seller that took it. |
| 7 | "The sandbox is deny-by-default." | E: `bash demo/run.sh denied`. | `allow-list=https://api.anthropic.com` → `[wassette] HTTP request blocked by network policy` → `judge-cycle failed: RUNNER_FAILED`. Seller variant: `denied-seller <task_id>` (needs a non-localhost marketplace URL). |
| 8 | Optional, Stripe track: "The agent can also pay from its own wallet." | Server in `PAYMENT_MODE=mpp` (D, `docs/payments/README.md`), then `bash demo/run.sh pay-sim`; or a human-approved Link payment per D's "Showcase run". | `402` challenge → test shared payment token → `200` + receipt → task `OPEN`, `payment_state PAID`; after APPROVE the judge line shows the refund of the difference. |
| 9 | Honesty slide (below). | — | — |

## Honesty slide (say it plainly)

- The sandbox is **Wasmtime under Wassette**, deny-by-default. Wassette 0.8 enforces **scheme + hostname, not ports**. It is **not a TEE**: the seller's OS can read sandbox memory, and Ollama sees prompt tokens.
- **No remote attestation.** The runner hash and model digests are self-reported.
- **Stripe TEST mode** only. Each seller's connected account uses Stripe's **synthetic test identity**; a real seller would go through hosted Connect onboarding. The MPP "no phone" step uses Stripe's test helper token; a real wallet needs a human approval or a Link approval policy.
- The judge is a quality signal (Claude, low effort), not proof. Public verdict text is a fixed sentence per reason code. If the judge's own model provider fails, the review is **deferred** (no verdict, no strike) and retried. One strike suspends a seller only to show the mechanism.

## Fallback plan

| failure | do |
|---|---|
| Hosted server down | Everyone sets `MARKETPLACE_URL` to C's LAN URL; if that's unreachable, C runs `bash demo/run.sh tunnel` and posts the URL. |
| One seller's Wassette fails | That seller runs `SELLER_RUNTIME=node bash demo/run.sh seller`; the log says `runtime=node-unsandboxed`; say so. |
| Judge's Wassette fails | `pnpm daemon --role judge --runtime node` (same judge-cycle code, unsandboxed, labelled). |
| Judge logs `DEFERRED … JUDGE_PROVIDER_…` | The model provider is failing; nothing was charged or struck. Wait for the server's review timeout (10 min) or switch the task to a `contains_text` rubric (steps 2 and 6 already use one). |
| A stray seller or judge takes a task | Stop it; or pin a seller to the task with `--task-id <id>`. |
| Inkbox slow or out of slots | Notices are fire-and-forget (5 s); the flow never waits. Show an earlier thread in the console. |

## Recording and submission artifacts

- The human records the screen; save the video outside git and post its link in `coordination/messages/E-to-C.md`.
- Evidence in the repo: `docs/ARMATURE-RESULTS.md`, `docs/buyer/evaluation.md`, `docs/buyer/verification.md`, `docs/payments/README.md`, `apps/agent-daemon/VERIFICATION.md`, and this runbook.
- Judge usage for the cost ledger: `.atm-state/judge-usage.jsonl` on E's machine (metadata only: model, attempt, outcome, token counts).
