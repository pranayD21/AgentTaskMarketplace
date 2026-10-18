# Completion audit and remaining assignments

## 2026-10-18 seller onboarding follow-up

C's revised installer is merged and deployed at `3006809`: a local dashboard, Google OAuth through InsForge, a linked seller identity, Ollama/resource monitoring and Stripe Connect setup. D supplied human account creation, onboarding links and idempotent retry support through `f4c5d76`. C's existing seller and judge retain their identities. D stopped its general worker at the human's request at 05:34:44Z; its registered identity remains. Benchmarks stay deferred.

Verified: workspace typecheck, 236 passing tests (2 optional Wassette tests skipped), Google ownership and retry tests, localhost access protection, rendered dashboard with real hardware/Ollama metadata, and a packaged Wassette canary (`qwen3:8b`, passed, 3.83 seconds, no marketplace task). Agent-table RLS was enabled on live InsForge: admin read retained access; anonymous read returned zero rows. Hosted health reports `3006809`; the public installer and both downloadable artifacts are available, and the bundle/runner match their published SHA-256 values. Unsigned enrollment returns 401; Stripe return/refresh pages are available. [Release evidence](../apps/agent-daemon/evidence/seller-onboarding-2026-10-18.json).

Still required for acceptance: a real human Google sign-in, human completion of Stripe TEST onboarding, a fresh-Mac install, a task completed by that installed worker, and login/reboot persistence. These checks require the target Mac and the human's account actions; mocks do not establish them.

B's human buyer form through `daba27b` is integrated. Its local bridge passed an isolated MEMORY/MOCK smoke test and B supplied separate live evidence. The public `/marketplace/` deployment is awaiting B's hosted asset adaptation; authenticated hosted purchasing also awaits the human's access-scope choice. Existing buyer keys, balances and the shared API ledger remain private and unchanged.


## A/C delivery status, October 17, 21:08 PDT

A and C's code is merged and deployed. Health at 04:04:05 UTC verified contract `0.3`, pricing `task_offer` and source `920c0525fb7f688b2c0699db83fac853d779e32b`. Workspace typecheck and all 201 tests passed, including actual Wassette. The Insforge posting/budget transaction and the task-offer smoke check passed.

| Assignment | Delivered | Remaining work |
| --- | --- | --- |
| Task pricing | Posted offers, quote-free sellers, preserved accepted prices, cap enforcement and market observations. | B's complete buyer/UI handoff; collect market data before claiming equilibrium. |
| J1/J2/J3 | Fixed public explanations including historical rows; infrastructure deferral; bounded replacement recovery. Tests cover privacy, outages and settlement effects. | E's final live fault/replacement rehearsal and B's status presentation. |
| P1/P2 | Atomic pending-post reservation, idempotent hold recovery, resumable settlement, transfer leases and provider reconciliation. D's MPP payment reservation fixes are included. | No production crash was injected; operate with the documented reconciliation limits. |
| F1 | Job/part contract, private payload boundaries, idempotent posting, job budgets and runtime correlation. | B's automatic decomposition/aggregation and grouped dashboard. |
| B1 | Shared usage schema, C runtime/hardware measurements and direct-local benchmark arm. | B's closed-source baseline is complete; B/D still need the marketplace arm and full accounting/comparison. |
| L1/D1 | [Hosted C/D proof](LIVE-C-D.md): one job, two physical sellers, 75.1s overlap, both APPROVED/verified, 60c transferred each, zero remaining reservation. | E's final fault/replacement rehearsal and recording. |
| I1 | Inkbox state/context persistence is integrated. | E's restart/live seller-thread proof remains limited by the three-identity free tier. |
| X1 | Confidential-compute design and honest security boundaries. Local model canary implemented. | Attested confidential inference is later scope; Wasm and model hashes do not hide inputs from the host owner. |

C's general seller remains running at the human's request. The completed two-part rehearsal used 120 cents of the existing C buyer cap. No Armature cap bypass, replacement buyer or paid benchmark run is authorized by this plan.

## Historical audit, October 17 at 20:05 PDT

The checklist below records the original findings and acceptance criteria. The current status above takes precedence.

Audited October 17, 2026, 20:05 PDT (October 18, 03:05 UTC). Code snapshot: `82d0aa2` on `main`; subsequent main commits through `b32a621` add coordination messages only. This report compares the user's original pasted discussion, the later requests for live work across computers and cost benchmarking, the agreed [hackathon plan](PLAN.md), source code, and the A–E handoffs.

**The core marketplace works. The full requested product is not complete.** The team has a hosted MCP server, local seller and judge workers, a dashboard and Stripe TEST settlement. Missing work includes job splitting and aggregation, proof of simultaneous work on separate physical computers, a measured comparison with a closed-source alternative, and several failure-handling fixes. Confidential execution against the machine owner remains outside the current implementation.

This audit assigns work; it does not claim those fixes are implemented or that another computer has started them. Each computer should pull the latest `main`, read the new section at the top of its own `tasks/<LETTER>.md`, and acknowledge its assignment. C continues integration on A's behalf under `A-C-20261018T021200Z-02`.

## What was checked

- Fresh run on `82d0aa2`: `pnpm -r typecheck && pnpm test && pnpm smoke` passed. There were 79 passing tests and one optional Wassette test skipped. The smoke suite used memory storage, mock payments and fake Ollama, all labelled. Both registered-key and per-claim flows returned APPROVED with verified commitments.
- Read-only checks at 20:02:50 PDT: hosted `/api/health` returned HTTP 200, contract `0.2`, card payments and Insforge Postgres; the LAN dashboard returned HTTP 200.
- Earlier evidence: the real-Wassette daemon suite passed 7/7; hosted seller and judge execution produced an approved result and Stripe TEST transfer; B independently reached the hosted service. These were not rerun as new purchases during this audit. See [progress](PROGRESS.md), [runtime verification](../apps/agent-daemon/VERIFICATION.md), [buyer verification](buyer/verification.md) and [payment documentation](payments/README.md).
- [Armature](ARMATURE-RESULTS.md): three scenarios passed 5/5 each. Recovery was simulated by omitting a known task ID. No actual network disconnect was injected. Pending-seller and rejected-result cases remain unrun for that buyer.
- Isolated fake-provider checks reproduced a provider 503 becoming `REJECT/JUDGE_ERROR` without a replacement, a commitment mismatch without a replacement, and a synthetic private marker appearing in `reason_public`. These checks used no external requests, real credentials or private task contents. They were audit probes, not newly committed regression tests.
- Incoming handoff received before publication: B has a buyer recovery-guidance fix and updated evaluation documentation ready in [PR #3](https://github.com/pranayD21/AgentTaskMarketplace/pull/3), branch `feat/b-buyer` at `39eaa4e`. B reports 82 passing tests, including three new isolated interrupted/malformed-response cases. These are branch results, not the audited main test count. C still needs to review, verify and integrate this handoff; it does not establish a real post-acceptance disconnect test. E acknowledged the handoff.
- The payment and Inkbox restart risks below were identified from source. Their acceptance tests still need to be written; no production failure was injected.

## Requirements at the original audit snapshot

| Requirement | Status and evidence | Remaining owner |
| --- | --- | --- |
| Buyer agent posts work through hosted MCP | Verified through real Claude Code/Codex clients and Manufact. See buyer verification and deployment docs. | A maintains server; B maintains buyer flow. |
| Public listings expose model, price and status, while task content stays private | Listing projection exists. The public verdict explanation can still carry private text from the judge model; see J1. | E + A, B checks UI/API. |
| First eligible seller claims a task once | Atomic claim and two-process race verified. The recorded race used two processes on one physical computer. | C leads separate-computer proof. |
| Worker uses an installed open-source model | Ollama inventory checked before `/api/chat`; live qwen3:8b execution verified. Inventory and hashes are self-reported. No canary or remote proof of model identity. | C, with A for published claims. |
| Sandboxed execution, encrypted task/result envelopes and commitment checks | Implemented and verified with Wassette, per-claim keys and network denial. Grants apply by hostname, not port. | C + E maintain. |
| Seller machine owner cannot inspect input, output or memory | Not implemented. The host controls Ollama and can inspect Wasm memory. The server also holds buyer keys. See [security model](SECURITY.md). | X1: A + C lead future design. |
| Judge verifies quality; rejected sellers are unpaid and struck | Normal APPROVE/REJECT paths verified. Provider failure can become a seller rejection; see J2. The MVP reviews every result, rather than sampling. | E + A + D. |
| Buyer receives a judge answer after rejection | Works on a tested rejection path, but is not guaranteed for commitment failures or replacement-provider failure; see J3. | E + A, B for status. |
| Stripe payments and agent payment approval | Card holds, capture, refunds and connected-account transfers have Stripe TEST evidence. D has human-approved MPP/Link evidence. Crash recovery and failed-transfer retry need P1/P2. Real bank payouts are outside this build. | A + D, B for labels. |
| Inkbox identity and task communication | Implemented with earlier notice evidence. Free tier supports marketplace + one buyer + one seller; judges and additional sellers may lack identities. Hosted final check and restart continuity remain I1. | E + A. |
| A buyer delegates parts of a job, with visible progress from several computers | Missing built-in parent/part grouping, automatic decomposition and verified aggregation. Current tasks are independent, each handled by one seller. | F1: B leads, all five contribute. |
| Product used live by several physical computers | Hosted remote buyer access exists. No complete evidence of two physical seller machines completing different parts of one job simultaneously. | L1: C leads, all five run roles. |
| Long-horizon or nested delegation | Current seller runs one model call with a bounded runtime. No general dependency graph, nested agent workflow or long-running checkpoint/resume implementation. | F1 delivers bounded parts first; A + B own later workflow design. |
| Benchmarks and cost comparison with a closed-source alternative | Missing committed comparison protocol, measured runs, complete usage accounting and results. Armature smoke cases are insufficient for a quality/cost claim. | B1: B leads, D owns cost accounting. |
| Five self-contained briefs and 20 directed message files | Present. This audit adds new assignments to all five briefs and sends C's four outbound handoffs. | All computers acknowledge and report evidence. |
| Final hosted demo, recording and submission | Some component demos exist. Final integrated rehearsal, hosted Inkbox proof and final demo/submission artifacts are not established by the available evidence. | D1: E leads, A/C integrate. |

## Fix before the next shared live demonstration

### J1. Keep private judge text out of public fields

**Lead E; A owns server enforcement; B verifies presentation.** In `packages/runner-core/src/index.ts`, `grade` copies the model's free-form `reason` into `reason_public`. Provider errors can also include response text. `service.ts` publishes that field through `dashboard()` and Inkbox verdict notices. A fake response containing a private marker reproduced the runner-side leak path. This does not establish that real user content has leaked.

E should emit fixed, safe public explanations derived from reason codes and keep any detailed reasoning within an authorized private channel, if retained at all. A must enforce the public projection at the server boundary, including historical rows, rather than trusting a judge-supplied string. B should test dashboard output with a synthetic private marker. Done means that marker appears in neither public API output, UI, notices nor logs, and normal buyers still receive their authorized results.

### J2. Treat judge infrastructure failures as retryable review failures

**Lead E; A owns state/lease rules; D verifies settlement.** The reproduced provider 503 returns `REJECT/JUDGE_ERROR`. The judge cycle submits that verdict, and `submitVerdict` increments strikes for every REJECT. With the configured one-strike threshold, an infrastructure failure can suspend a seller.

E should distinguish unavailable, timed-out or malformed judge responses from an actual failed rubric. A should make the retry path explicit and prevent infrastructure failures from triggering seller penalties or final quality settlement. Publish the contract before changing worker behavior. Done means 503, timeout and malformed-response tests preserve seller reputation, avoid duplicate payment effects, expose a recoverable review status and succeed after recovery with bounded retries.

### J3. Make replacement-answer availability explicit

**Lead E; A defines recovery state; B displays it.** Commitment/task-ID mismatches return before replacement generation. The replacement helper also catches provider failures and returns no answer. The existing test permits this absence.

Add a bounded replacement retry/retrieval path, with an explicit pending or unavailable status. Preserve the original rejection reason without treating a missing replacement as successful delivery. Done means mismatch and provider-outage cases have truthful buyer status, a recoverable replacement when the provider returns, and no duplicate refund, strike or charge.

### P1. Recover money and database state after partial failures

**Lead A; D owns payment-provider changes and money assertions.** Source findings in `service.ts`:

- `postTask` reserves the cap and places a hold before inserting the task. The insert has no compensation path if it fails after a successful hold.
- `submitVerdict` records a settlement before updating task state, seller reputation and buyer balances. A retry returns early whenever that settlement exists, so it cannot finish those writes after an intervening crash.

Add durable or resumable finalization and hold compensation. Use isolated database/provider fault injection first. Done means failure after each side effect can be retried or reconciled without orphaned holds, duplicate captures/refunds, lost or duplicate strikes, or stranded reserved balance. This audit found risks in source; it did not trigger them on the shared server.

### P2. Reconcile captured payments whose seller transfer failed

**Lead D; A owns persistence/retry scheduling; B owns display.** `transferToSeller` returns a null transfer ID plus a pending note on onboarding/provider failure. The service can record an APPROVED task and the full intended seller payout, then skip capture/transfer on subsequent verdict submissions because a settlement exists.

Preserve the pending fallback, add an idempotent retry path, and distinguish amount owed from amount actually transferred. Done means a failed transfer later completes once, its ID is recorded, and the UI never labels a pending amount as paid. Existing successful Stripe TEST transfer evidence remains valid.

### I1. Finish hosted Inkbox proof and survive restarts

**Lead E; A assists with persisted recipient/context fields.** `inkbox.ts` keeps `threadOwner` and recipient contexts in memory. A restart between claim and submission can lose the owner needed for subsequent notices or break thread continuity.

Persist or reconstruct recipient ownership and context. Verify assignment, submitted and verdict notices for the same task through a server restart using existing identities. Keep quota exhaustion explicit and preserve marketplace operation when notices fail. Do not reset shared Inkbox identities. E's existing human-dependent handoff remains in force; post a blocker if that prevents the live check.

## Complete the user's remaining product requests

### F1. Split one buyer job into parts and combine verified results

**Lead B.** A first publishes the shared contract and any database migration. The public view needs an opaque parent job ID, safe part labels/IDs, dependencies if used, assigned seller/computer and progress. Prompts, context and results remain private. B implements buyer-side decomposition, bounded posting, resume without duplicate purchases, result verification and aggregation, plus dashboard grouping. Start with independent parts; explicitly defer general nested workflows if they cannot be delivered.

Contributions: A handles contract/persistence and job status; C makes workers consume supported parts and report safe progress; D checks the total job budget and accounting across parts/retries; E checks part quality and aggregate completeness. Coordinate edits to `packages/shared` and runner files through A/C/E ownership.

Done means one buyer instruction produces at least two useful child tasks, each has a stable ID, the buyer can restart without reposting accepted work, the total stays within its authorized cap, and the final response combines only verified results. A failure in one part must remain visible. Unit tests should cover partial failure and ambiguous posting outcomes.

### L1. Prove a live run across physical computers

**Lead C.** Use the hosted MCP endpoint and retain existing working identities. Roles for the rehearsal:

| Computer | Runtime responsibility |
| --- | --- |
| A | Hosted server health, contract and integration support. C remains acting integrator while A is delegated away. |
| B | Buyer agent posts the bounded job; dashboard shows parent, parts, assignment and progress. |
| C | First physical seller with local Ollama and Wassette. |
| D | Second physical seller with local Ollama and Wassette; payment observation. C supplies setup support. |
| E | Judge worker and Inkbox/demo capture. |

If D cannot run the required local model, reassign the second seller to a capable A or E machine and record that decision in the directed messages. Still require two distinct physical seller machines. Do not count multiple processes on C as multiple computers.

Acceptance evidence: commit and component hash; machine letter to seller-ID mapping without credentials; parent and child IDs; overlapping claimed/running timestamps on two machines; visible progress; verified results; judge outcomes; reconciled cap, holds and settlement; recovery when one worker disconnects. A metadata screenshot alone is insufficient. B's current remote MCP access and C's local race are useful prerequisites, but do not close this item.

### V1. Finish evaluation cases and test a real ambiguous post outcome

**Lead B; E supplies rejected-result evidence; A/D coordinate fixtures and budget.** Run the pending-seller and rejected-result Armature scenarios using suitable authorized fixtures. Separately, in a controlled local test, drop the response after the server accepts a post, then verify recovery without a duplicate task or charge. The existing simulated missing-ID case remains labelled as simulated.

The existing Armature buyer has 25 cents available and the card-task minimum is 50 cents. It owns no OPEN or REJECTED fixture. Do not raise its cap or create a substitute buyer to bypass this limit. Reuse an authorized fixture if available; otherwise record the exact fixture/budget need for the human. Local fake-provider tests can proceed without that live fixture. Save a redacted result for each case. B has already updated `docs/buyer/evaluation.md` and `docs/buyer/verification.md` for the three passing scenarios in PR #3 (`39eaa4e`); C owns reviewing and integrating that existing handoff. B should extend those records only when new evidence exists.

### B1. Produce a reproducible quality, latency and cost comparison

**Lead B; D leads the cost ledger; C/E/A supply measurements.** No benchmark result is complete yet. Deliver these in order:

1. B writes `docs/buyer/benchmark-plan.md`: named, versioned workloads appropriate to the tasks the product supports, dataset/license/source links, exact case selection, prompts, rubrics, sample counts, repeats, timeouts, model versions and commands. Include functional failure scenarios separately from task-quality benchmarks. Select and name the closed-source baseline, with its exact model/version and settings, before running it.
2. Compare the same tasks through direct local inference, the marketplace, and the closed-source baseline. Use paired cases and the same quality criteria. Separate cold and warm local runs; randomize ordering where practical. Report success rate, quality, end-to-end p50/p95 latency, throughput, retries and failure rate. Keep per-case results so aggregate claims can be checked.
3. A publishes the shared usage/result schema. B owns the harness under `scripts/benchmarks/**` and the report under `docs/buyer/**`. C records seller input/output tokens, elapsed inference/load time, hardware and measured energy or an explicitly labelled estimate. E records judge and replacement API usage, including input/output/cache tokens and every retry. A records hosting/database/MCP usage. D reconciles payment fees and marketplace charges separately from resource costs.
4. D documents two views: buyer cost (marketplace price plus buyer/controller/baseline calls) and system resource cost (local energy, stated hardware amortization, hosting, judging, replacements and relevant fees). Avoid double-counting the marketplace transfer as both resource cost and buyer spend. For each view report total cost divided by successful tasks, with a declared allocation of failed attempts. Show currency, rate sources/date and uncertainty. Missing usage must remain unknown, never zero.
5. B saves versioned redacted raw results and a report with reproducible commands, quality-matched cost comparisons and limits. External benchmark calls use the human's authorized budget. Do not infer savings from the 75-cent Stripe TEST price or Armature's delayed credit counter.

Paths `scripts/benchmarks/**` are assigned to B for this follow-up. A retains root scripts, shared types and database ownership. Pricing/model availability must be checked against current official sources when the protocol is written and run.

### D1. Rehearse and publish an accurate demo

**Lead E; all five participate.** Correct `demo/run.sh`'s extra `--` in server startup and update stale instructions about localhost, pending onboarding and identity resets. Use `/api/health` for application configuration. Assemble hosted accepted/rejected flows, two physical sellers, sandbox denial, Stripe TEST evidence and existing-identity Inkbox notices. Preserve honest labels for mocked, unsandboxed, pending and unverified behavior.

Done means a repeatable runbook, a complete team rehearsal and the final recording/submission artifacts with their locations. A/C reconcile README/PLAN/PROGRESS claims; B updates buyer docs. The historical checklists below each computer's latest assignment must not be treated as a fresh request to rebuild completed components.

## Explicit scope limits and later work

### X1. Original vision beyond the hackathon implementation

These are not silently marked complete:

- **Host confidentiality and remote attestation:** A + C own a follow-up design for an attested confidential inference environment, key release and buyer trust. E handles equivalent judge isolation. Ordinary Wasm plus a self-reported hash cannot prove that the host cannot inspect execution.
- **Model identity:** C owns a liveness canary or clear deferral. A corrects claims that inventory is already liveness-checked. A canary can provide operational evidence but does not prove execution against a malicious host. Cryptographic model/runtime attestation remains separate work.
- **Production payments and human enrollment:** D + A own real onboarding, live-money operation and operator-approved enrollment/cap changes if the product moves beyond a test demo. The current per-buyer cap is enforced, but public registration accepts a caller-supplied cap and creates a new allowance. There is no enforced human/account approval boundary at enrollment.
- **General long-horizon nested delegation:** A + B own dependency scheduling, checkpoints and nested orchestration after F1's bounded independent parts.
- **On-chain/x402, Primitive, Blaxel, OCI publishing and buyer-side key custody:** explicitly omitted or stretch items in the agreed MVP; do not block the hackathon on these optional choices. Stripe/MPP is the implemented payment direction. The transcript's on-chain suggestion was optional.
- **Random judge sampling:** explicitly replaced by 100% review in the MVP. This is a scope decision, not an unimplemented required sampling switch. Account for its cost in B1.

## Handoff order and completion rule

1. A/E agree on J1–J3 state and public-data contracts. A/D fix P1/P2. E handles I1. These fixes can proceed in parallel within file ownership.
2. A publishes F1 and benchmark measurement contracts. B builds buyer orchestration/UI and the harness; C/D prepare separate sellers; E prepares judge metrics and the runbook.
3. C reviews and integrates B's ready PR #3 (`39eaa4e`) and other tested handoffs, runs workspace typecheck/tests/smoke, then rebuilds and runs actual Wassette checks if runtime code changed. Deploy only a verified integration and record the deployed revision.
4. All five perform L1/D1 with authorized fixtures. B completes V1 where fixtures permit and B1 under the agreed benchmark budget.

Every handoff names the assignment ID, branch and commit, files changed, exact verification command, observed result and remaining limits. Append messages only to your own four outbound files. Reply to C with evidence so the acting integrator can update status. No item becomes complete merely because code was written or a worker was launched.
