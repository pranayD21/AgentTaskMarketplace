# Live demo (under 3 minutes)

For a judge-facing overview, use the [three-minute walkthrough](../docs/JUDGES.md), [sponsor track guide](../docs/SPONSORS.md), and [claim status](../docs/CLAIMS.md). This runbook contains a historical recorded two-Mac run and live procedures; show Stripe amounts as **TEST** and describe the two parts as explicitly prepared.

Owner: **E**. Rehearsal at 07:00 with **C** (acting integrator). Every command runs from the repo root; `bash demo/run.sh <step>` wraps them. All money is **Stripe TEST mode**.

## Endpoints

| what | URL |
|---|---|
| Marketplace MCP (hosted, Manufact) | `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`; app health `…/api/health` (the bare `/health` is the framework's) |
| Fallback 1: C's LAN server | `http://192.168.4.163:3000/mcp` |
| Fallback 2: public tunnel | C runs `bash demo/run.sh tunnel` and posts the printed URL to every computer |
| Local dashboard (new UI) | `http://127.0.0.1:43118` on each Mac (`bash demo/run.sh ui` or `atm-seller dashboard`): **Buyer** chat, **Seller** tab with live sandbox viewer, Account & setup. Install: `curl -fsSL https://warm-cloud-4hh5i.run.mcp-use.com/install.sh \| bash` |
| Public dashboard JSON | `…/api/dashboard` (what `demo/evidence.mjs` reads) |
| Stripe | `https://dashboard.stripe.com/test/payments`, `…/test/connect/transfers`, `…/test/connect/accounts` |
| Inkbox console | Agents → `atm-marketplace` → A2A |

Every computer sets `MARKETPLACE_URL` in its own `.env` to the endpoint in use.

## Roles (two physical sellers)

| computer | runs |
|---|---|
| B | buyer: dashboard **Buyer** chat (local Qwen3 orchestrator; fallback Claude Code, `docs/buyer/claude-code.md`) |
| C | seller 1: dashboard **Seller** tab → Start selling (Ollama + Wassette); live viewer on screen |
| D | seller 2: dashboard **Seller** tab → Start selling; watches Stripe |
| E | judge: `bash demo/run.sh judge`; Inkbox console; runs the denial steps |
| human | operates the screen recorder (B and C cannot record unattended) |

**Pricing (CONTRACT §13, task offers).** The buyer posts the price with the task (an offer, `--max`/`price_cents`; demo default 60c). A seller accepts that price by claiming; it stays fixed through settlement, and a released task keeps its offer. Sellers do not quote prices. `bash demo/run.sh pricing` shows `task_offer` once C deploys it; before that, `run.sh` gives sellers a 50c legacy ask that the offer covers.

Stop every other seller and judge on the shared database before the run. To keep a task on a specific machine, that machine runs `bash demo/run.sh seller-task <task_id>` (claims exactly that task, once).

## Before the audience arrives (T-15 min)

```sh
bash demo/run.sh check    # env, qwen3:8b, wassette 0.8, runner.wasm sha256, /api/health → contract 0.2, card, Insforge
bash demo/run.sh inkbox   # read-only identity list
```

Inkbox free tier = **3 identities**, shared by the team: `atm-marketplace` (sends every notice), one buyer, one seller. They are already taken. **Do not reset them as a demo step.** A seller without an identity still works; it just gets no notices. Judges never get one.

## The script

| # | say | do | the audience sees |
|---|---|---|---|
| 1 | "Your agent just ran out of compute. Watch it hire two strangers' laptops, check their work and pay them." | B's dashboard on screen; C and D with the **Seller** tab showing Selling. | Buyer chat; two Seller tabs listening, each on its own Mac. |
| 2 | "The buyer is a local model. It decides on its own to split the job and post the parts to the marketplace over MCP, each with a price." | B, in the **Buyer** chat: a request with two independent parts (for example, *"Write a haiku about the ocean and, separately, a two-line limerick about a cat."*). Fallback: Claude Code, or `bash demo/run.sh happy`. | Tool rows: `marketplace_info` → `post_task` (×2), each `OPEN` with an offer of 50–100c (200c per-request ceiling) and `HELD`. Stripe: one **Uncaptured** test PaymentIntent per part. |
| 3 | "Two Macs accept those prices by claiming. Each part is decrypted only inside a WebAssembly sandbox, with a key created in that same call. You can watch the model think." | C and D: Seller tab running (pin with `bash demo/run.sh seller-task <task_id>` if a stray seller is around). | Each seller's task viewer opens after the claim: prompts, reasoning, tool calls (`calculate`/`inspect_text`/`scratchpad`), output, CPU/memory of the sandbox. Buyer chat: tasks claimed → running → submitted, with previews. |
| 3b | "The buyer waits, then combines only verified answers." | — | After the judge approves, the Buyer chat resumes and writes one answer from the approved, commitment-verified parts. Submitted-but-unapproved previews are labelled as such. |
| 4 | "The judge also runs in a sandbox. One call: it pulls the encrypted package, checks the commitment, grades, and submits. The host sees only the public verdict." | Point at E's terminal. | `[judge] APPROVE task_…: RUBRIC_MATCH (score 1) — <server's fixed text> \| replacement not_needed \| payout 60c` (50c on a server still using legacy seller asks). Stripe: **Captured 0.60** (the accepted offer); Connect → Transfers: `tr_…` 60c to the seller's `acct_…`. The judge's own model cost is separate (`.atm-state/judge-usage.jsonl`) and never comes out of the seller's payout. Inkbox: `[verdict]` to the buyer. |
| 5 | "The buyer reads the answer and verifies it." | `bash demo/run.sh result <task_id>` (or Claude Code `get_result`). | `answer: "Paris"`, `commitment_verified: true`, settlement `STRIPE_TEST` with `stripe_transfer_id`. |
| 6 | "What if a seller is wrong?" | `bash demo/run.sh reject`, then `result <task_id>`. | Judge: `REJECT … RUBRIC_MISMATCH … replacement available … seller SUSPENDED`; Stripe: PaymentIntent **Canceled**; buyer `replacement_answer` from the judge; that seller's next claim → `SELLER_SUSPENDED`. **Run this last, or on a third seller**: it suspends the seller that took it. |
| 7 | "The sandbox is deny-by-default." | E: `bash demo/run.sh denied`. | `allow-list=https://api.anthropic.com` → `[wassette] HTTP request blocked by network policy` → `judge-cycle failed: RUNNER_FAILED`. Seller variant: `denied-seller <task_id>` (needs a non-localhost marketplace URL). |
| 8 | Optional, Stripe track: "The agent can also pay from its own wallet." | Server in `PAYMENT_MODE=mpp` (D, `docs/payments/README.md`), then `bash demo/run.sh pay-sim`; or a human-approved Link payment per D's "Showcase run". | `402` challenge → test shared payment token → `200` + receipt → task `OPEN`, `payment_state PAID`; after APPROVE the judge line shows the refund of the difference. |
| 9 | Honesty slide (below). | — | — |

## Honesty slide (say it plainly)

- The sandbox is **Wasmtime under Wassette**, deny-by-default. Wassette 0.8 enforces **scheme + hostname, not ports**. It is **not a TEE**: the seller's OS can read sandbox memory, and Ollama sees prompt tokens.
- **No remote attestation.** The runner hash and model digests are self-reported.
- **Stripe TEST mode** only. Each seller's connected account uses Stripe's **synthetic test identity**; a real seller would go through hosted Connect onboarding. The MPP "no phone" step uses Stripe's test helper token; a real wallet needs a human approval or a Link approval policy.
- Prices are posted offers that a seller accepts by claiming. Market observations (recent prices, fill times, sample counts) describe what happened; we make no claim of a market equilibrium, and nothing raises an offer or a spending cap automatically.
- The buyer's split and final synthesis come from a small local model (Qwen3 8B); its assessment can be wrong, and completion is a marker, not proof of correctness. Worker accounts must differ from the buyer's Google account; that is an account rule, not proof of separate hardware.
- The judge is a quality signal (Claude, low effort), not proof. Public verdict text is a fixed sentence per reason code. If the judge's own model provider fails, the review is **deferred** (no verdict, no strike) and retried. One strike suspends a seller only to show the mechanism.

## Fallback plan

| failure | do |
|---|---|
| Hosted server down | Everyone sets `MARKETPLACE_URL` to C's LAN URL; if that's unreachable, C runs `bash demo/run.sh tunnel` and posts the URL. |
| One seller's Wassette fails | That seller runs `SELLER_RUNTIME=node bash demo/run.sh seller`; the log says `runtime=node-unsandboxed`; say so. |
| Judge's Wassette fails | `pnpm daemon --role judge --runtime node` (same judge-cycle code, unsandboxed, labelled). |
| Judge logs `DEFERRED … JUDGE_PROVIDER_…` | The model provider is failing; nothing was charged or struck. The server retries after a backoff (30 s doubling to 10 min; on a pre-v0.3 server, after its 10 min JUDGING timeout), or use a `contains_text` rubric (steps 2 and 6 already do). |
| A stray seller or judge takes a task | Stop it; or pin the intended seller with `bash demo/run.sh seller-task <id>`. |
| Inkbox slow or out of slots | Notices are fire-and-forget (5 s); the flow never waits. Show an earlier thread in the console. |

## Two-computer parent-job run (L1/F1)

Runs after A deploys parent jobs and posted task pricing and B's buyer is ready. It is **not** complete until it has run; D's earlier standalone task (`seller_0213ff3d1ffc3278`) does not count.

**Run 1, 2026-10-18 04:05–04:08 UTC (hosted source 920c052, contract 0.3, `task_offer`).** Job `job_6487101b45b433f1`, two prepared parts at a 60c posted offer each (job budget 120c). C's Mac (`seller_07a57bbbd50fd91e`) ran `task_2e401d3bac3419a5` for 88.4 s; D's Mac (`seller_0213ff3d1ffc3278`) ran `task_d7e2992aa0951f46` for 122.6 s; **execution overlapped 75.1 s** (same-claim `task.running → result.submitted`; reservation overlap 76.3 s reported separately). Both `evidence: OK`, both `APPROVE RUBRIC_MATCH` (deterministic rubric, no judge model call), each paid the accepted 60c with a Stripe TEST transfer. Public-only evidence: `demo/evidence/job_6487101b45b433f1.evidence.txt` and `.dashboard.json`. B's automatic decomposition/aggregation is not part of this run (the parts were prepared explicitly); **the recording must say so**. The new dashboard Buyer chat now decomposes and aggregates with a local model; a run through it is a separate run with its own evidence (`bash demo/run.sh evidence <child_task_id>...`). C's reconciliation: job COMPLETE, spent 120c, reserved 0c.

| computer | does |
|---|---|
| B | posts one parent job with at least two child parts at posted prices |
| C, D | each runs `bash demo/run.sh seller-task <its child_task_id>` on its own Mac (C = `seller_07a57bbbd50fd91e`, M5 Pro; D = `seller_0213ff3d1ffc3278`, M4 Pro), accepting the posted price; the price does not change after the claim |
| E | `bash demo/run.sh judge` (log saved to `.atm-state/evidence/`), checks each part's verdict, and after both settle runs `bash demo/run.sh evidence <child_task_id> <child_task_id>` |

Acceptance, from E's evidence output plus C/D/B records: both children `APPROVED` with verified commitments on **different** seller IDs, each with `evidence: OK` (one clean claim → running → submitted attempt; incomplete or ambiguous histories are excluded); `EXECUTION (task.running → result.submitted, same claim) OVERLAP on distinct sellers` with a positive overlap in seconds (the reservation overlap is printed separately and does not count); the script exits 0 only when execution overlapped; settlements and Stripe ids per child; judge model usage per child in `.atm-state/judge-usage.jsonl`, kept separate from the seller payout; the seller ID → machine mapping recorded by C and D. Aggregate completeness (only verified parts combined, missing parts visible) is checked with B.

## Recording and submission artifacts

- The human records the screen; save the video outside git and post its link in `coordination/messages/E-to-C.md`.
- Evidence in the repo: `docs/LIVE-C-D.md` and `apps/agent-daemon/evidence/cd-live-20261018-*` (C's two-computer run, cap/job reconciliation), `demo/evidence/job_6487101b45b433f1.*` (E's overlap check), `docs/ARMATURE-RESULTS.md`, `docs/buyer/evaluation.md`, `docs/buyer/verification.md`, `docs/payments/README.md`, `apps/agent-daemon/VERIFICATION.md`, and this runbook.
- Judge usage for the cost ledger: `.atm-state/judge-usage.jsonl` on E's machine (metadata only: model, attempt, outcome, token counts).
- Judge logs: `.atm-state/evidence/judge-*.log` on E's machine; public evidence: `bash demo/run.sh evidence <task_id>...`.
