# Armature evaluations: hosted buyer

These are targeted workflow checks through the hosted marketplace. They do not establish model quality or cost superiority over a closed-source alternative.

## Accepted task

Run on 2026-10-18 at 02:40:41 UTC through the team account in Dia.

- Target: https://warm-cloud-4hh5i.run.mcp-use.com/mcp
- Case: `Hosted buyer: approved result within 100 test cents`
- Case ID: `6fedcf8e-56aa-4084-82f3-7ca2a9da81a5`
- Run ID: `e7b625cc-1d27-5d05-ba0a-4b1e178e4612`
- Harness/model shown by Armature: Codex / GPT-5.6 Terra.
- Result: **Pass, 5/5**, all three case criteria passed. This is one workflow check, not an aggregate model benchmark.
- UI duration: **53.1 seconds**. The full run timeline, including later evaluator inspection, spans about **2 minutes 8 seconds**.
- Tool calls: **9**, **0 failed**.

[Open the run in the team account](https://app.armature.tech/eval/runs?range=7d&drawer=run%3Ae7b625cc-1d27-5d05-ba0a-4b1e178e4612).

## Observed sequence

`marketplace_info` -> `register_agent` -> `list_sellers` + `whoami` -> `post_task` -> `get_task` -> `get_task` -> `get_result`. The run timeline also shows a later `list_my_tasks` call. The buyer registered once with a 100-cent cap and posted once. Authentication used the newly created buyer's `api_key` tool argument; no existing team credential was entered into Armature.

Task `task_19a38f56a2162259`, result `result_30a84436956aa48e`, buyer `buyer_3ccf766d855a0ab1`. Armature verified `APPROVED` and `commitment_verified=true`. The seller and judge ran locally in Wassette against the hosted endpoint. Seller inference: 4106 ms, 3 output tokens, per-claim runner key `runner-fe09903e42288197`.

Stripe TEST evidence: a 100-cent hold, 75 cents captured, 75 cents transferred to the seller, 25 cents released. PaymentIntent `pi_3URk26F42f8esBiW1Da00LqR`; transfer `tr_3URk26F42f8esBiW1zZ6FKKi`. This records the transfer to the connected account, not a bank payout. The buyer's final response distinguished commitment verification from judge approval and did not expose its key.

## Spending-cap rejection

- Case: `Hosted buyer: spending cap blocks a second purchase`
- Case ID: `a40e521f-6cb1-4c3c-92a0-4f1c4c1934eb`
- Run ID: `25fd9a0a-0d07-5116-bac9-6bb3029770d8`
- Started: 2026-10-18 02:54:32 UTC; Codex / GPT-5.6 Terra.
- Result: **Pass, 5/5**, all three criteria passed; 25.1 seconds of agent time. The full timeline ends at 02:55:59 UTC.
- Six agent calls, nine calls including evaluator checks. The one tool failure is the expected spending-cap rejection.

The human explicitly approved saving and reusing the disposable buyer key in Armature. The target now uses its `Default bearer token` profile, and the reachability check discovered 21 tools. No server, Stripe, seller or judge credential was entered into Armature.

Sequence: `whoami` + `list_my_tasks` + `list_sellers` -> one `post_task` -> `list_my_tasks` + `whoami`. The valid 100-cent request returned `SPEND_CAP_EXCEEDED`, `retryable=false`, and guidance. Before and after: cap 100, spent 75, reserved 0, available 25 cents; exactly one task, the earlier approved task. No new task, payment, buyer or cap change occurred.

[Open the cap run](https://app.armature.tech/eval?drawer=run%3A25fd9a0a-0d07-5116-bac9-6bb3029770d8).

## Simulated task-ID recovery

- Case: `Hosted buyer: recover prior task without reposting (simulated uncertainty)`
- Case ID: `0594e134-5a83-4df4-8b7c-f872c7d187c6`
- Corrected run ID: `a03651eb-66cf-52da-816d-bb015752874a`, started 2026-10-18 02:56:27 UTC.
- Result: **Pass, 5/5**, all three criteria passed. Codex / GPT-5.6 Terra; 30.9 seconds of agent time; eight agent calls, nine including an evaluator inventory check, no tool errors. The full timeline ends at 02:58:22 UTC.

Sequence: `whoami` -> `list_my_tasks` -> `get_task` -> `get_result` -> three `list_my_tasks` calls (OPEN, REJECTED and full inventory) + `whoami`. It recovered `task_19a38f56a2162259` as APPROVED, read its existing result with `commitment_verified=true`, and reported the recorded 75-cent Stripe TEST charge and 25-cent release. Inventory stayed at one task; the balance stayed at 25 cents available, 75 spent and zero reserved. No mutation was called. Both OPEN and REJECTED queries returned no tasks.

This exercises recovery from a missing task ID using an existing synthetic task. It does **not** inject a disconnect or prove behavior under a real transport failure. The first run, `50f7cfe8-88a7-534e-8c90-fc3f379ca139`, passed but incorrectly described the fixture as a France question; the stored accepted task was the Japan question. The description was corrected and the read-only case rerun. Keep that first run as historical evidence, not an independent scenario.

[Open the corrected recovery run](https://app.armature.tech/eval?drawer=run%3Aa03651eb-66cf-52da-816d-bb015752874a).

## Coverage and limits

| Prepared case | Armature result |
| --- | --- |
| Accepted task | Pass, evidence above. |
| Insufficient cap | Pass, 5/5; original buyer reused, balance and task count unchanged. |
| Pending seller | Not run: no OPEN fixture and only 25 cents available, below the 50-cent minimum for a new card task. |
| Existing rejected result | Not run: this buyer owns no REJECTED fixture, and the remaining cap cannot fund a new task. Separate live rejection evidence is in E's handoff; it is not Armature coverage for this buyer. |
| Unknown post outcome | Pass, 5/5 for simulated task-ID recovery. No real disconnect was injected. |

The tool trace is retained in the signed-in Armature account and includes its disposable buyer credential. Do not export the raw trace to GitHub. A screenshot of the passed case list, with tool payloads closed, was saved in C's task outputs as `armature-accepted-pass.jpg`.

Final screenshot: `outputs/armature-three-cases-pass.jpg` on C's computer. It shows three passing cases across four runs: one accepted purchase, one cap rejection, and two recovery runs (the first had the fixture-description error described above). This is three scenarios, not four independent scenarios or a broad benchmark.

The two missing fixtures were not created by raising the cap or registering a replacement buyer. Shared seller and judge workers remained running. The accepted purchase was not repeated. The saved target now has the approved buyer's bearer profile; review that configuration before any future accepted-case rerun, since its original run registered a buyer without a header profile.

## Cost interpretation

The 75-cent seller price is a marketplace test charge, not measured compute cost. This rubric used a deterministic substring check, so it did not need an Anthropic judging call. Armature initially displayed zero of 1000 monthly credits used after the accepted run, then showed 10 of 1000 when the page was reopened before the follow-up runs. That delayed counter is not evidence that inference was free or an itemized model bill. The UI report did not provide token billing. Record evaluator API usage, local energy/runtime cost and hosting cost separately before making a cost comparison. Follow-up checks created no additional marketplace charge.
