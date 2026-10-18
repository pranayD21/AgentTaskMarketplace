# Live C/D parent-job verification

Verified October 18, 2026, 04:08 UTC. Server source: `920c0525fb7f688b2c0699db83fac853d779e32b`; Manufact deployment: `00ff5e85-9e13-427d-8cc4-05064270bf63`. Hosted health reported contract 0.3, task-offer pricing, card payments and Insforge Postgres.

## Result

**Two physical computers completed different parts of one job, with 75.1 seconds of overlapping execution.** Both results passed their deterministic rubric and buyer commitment checks. Each task kept its posted 60-cent price through claim, capture and transfer. All payment evidence is Stripe TEST mode.

The buyer integration script created job `job_6487101b45b433f1` and two explicitly prepared parts. C and D's general workers claimed from the same pool. The script used stable job/post request keys and the existing buyer `buyer_fcb622d0211a304d`. It created no replacement buyer and changed no cap. B's automatic decomposition and aggregation remain separate work.

| Computer | Task | Claim | Running, UTC | Submitted, UTC | Result | Offer / transferred |
| --- | --- | --- | --- | --- | --- | --- |
| C | `task_2e401d3bac3419a5` | `claim_548203da224aa5d8` | 2026-10-18T04:05:29.636654+00:00 | 2026-10-18T04:06:58.029099+00:00 | APPROVED; commitment verified | 60c / 60c |
| D | `task_d7e2992aa0951f46` | `claim_68bdb47e956f2fb6` | 2026-10-18T04:05:42.929383+00:00 | 2026-10-18T04:07:45.539704+00:00 | APPROVED; commitment verified | 60c / 60c |

Overlap is computed from `task.running` to `result.submitted` for the same claim and seller. Reservation overlap was 76.3 seconds and is reported separately. These server event windows include submission overhead. The machine mapping comes from the team's physical-computer reports and local usage logs; it is not hardware attestation.

## Accounting and grading

- Job budget: 120c. Final job state: COMPLETE; two approved parts, spent 120c, reserved 0c.
- Existing buyer cap: 2000c. Spent changed from 435c to 555c; reserved returned to 0c; available is 1445c.
- Both settlements are RECORDED, CAPTURED and TRANSFERRED. Each records 60c owed and 60c transferred, a provider capture ID and a transfer ID, with no pending transfer or manual-review flag.
- Both verdicts were `APPROVE / RUBRIC_MATCH`. The judge log recorded zero model calls for each. The criterion was marker matching; no factual accuracy score was computed.
- Market observations returned two posted/accepted 60c offers and `sample_status: insufficient_data`. Two tasks cannot establish market equilibrium.

## Machines and workers

| Computer | Seller | Hardware | Runner |
| --- | --- | --- | --- |
| C | `seller_07a57bbbd50fd91e` | Apple M5 Pro, 18 CPU cores, 48 GiB | Wassette 0.8.0; component `a3662f2c2b4358d213c22923683e98f2579e7789e04df2eba7632ee898360e34` |
| D | `seller_0213ff3d1ffc3278` | Apple M4 Pro, 12 CPU cores, 24 GB | Wassette 0.8.0; component `94c8b1ca616bb367b63333955b5ec549392804e101b91e5d9b9550596aed713d` |

Both used local `qwen3:8b`, reported digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. Component hashes identify the recorded local builds; model hashes and canaries remain self-reported evidence.

C's general seller resumed at 04:03 UTC and remains running, as requested by the human. Its existing judge identity `judge_00b762de5b57f6fa` resumed at 04:04 UTC. D reported its general worker running from 04:03:56 UTC. Workers poll every five seconds. No identities were reset.

## Saved evidence

- [Public events and settlement snapshot](../apps/agent-daemon/evidence/cd-live-20261018-dashboard.json)
- [Buyer verification, job accounting and market observations](../apps/agent-daemon/evidence/cd-live-20261018-results.json)
- [C usage rows](../apps/agent-daemon/evidence/cd-live-20261018-c-usage.jsonl): 98 input tokens, 3408 output tokens, 86.9 seconds runner time. Energy was not measured.
- [Overlap calculation](../apps/agent-daemon/evidence/cd-live-20261018-overlap.txt)

Recheck the saved evidence without an API key or external calls:

```sh
ATM_DASHBOARD_FILE=apps/agent-daemon/evidence/cd-live-20261018-dashboard.json   node demo/evidence.mjs task_2e401d3bac3419a5 task_d7e2992aa0951f46
```

The command exits 0 only when valid execution windows overlap on distinct sellers. The saved artifacts contain metadata and verification flags; task text, answers and credentials are omitted.

## Remaining project work

B's automatic buyer workflow and grouped UI are in progress. B has completed the pinned closed-source baseline and incorporated C's local benchmark; the full marketplace cost arm remains gated on allocation and judge/replacement cost bounds. E owns the final recording, live fault/replacement rehearsal and Inkbox continuity check. Attested confidential inference remains later scope.
