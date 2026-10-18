# Armature evaluation: hosted buyer

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

## Coverage and limits

| Prepared case | Armature result |
| --- | --- |
| Accepted task | Pass, evidence above. |
| Insufficient cap | Not run in Armature. Covered separately by server regression tests. |
| Pending seller | Not run in Armature. |
| Existing rejected result | Not run in Armature. Separate live rejection evidence is in E's handoff. |
| Unknown post outcome | Not run in Armature. |

The tool trace is retained in the signed-in Armature account and includes its disposable buyer credential. Do not export the raw trace to GitHub. A screenshot of the passed case list, with tool payloads closed, was saved in C's task outputs as `armature-accepted-pass.png`.

## Cost interpretation

The 75-cent seller price is a marketplace test charge, not measured compute cost. This rubric used a deterministic substring check, so it did not need an Anthropic judging call. Armature displayed zero of 1000 monthly credits used after the run; that counter is not evidence that model inference was free. The UI report did not provide token billing. Record evaluator API usage, local energy/runtime cost and hosting cost separately before making a cost comparison.
