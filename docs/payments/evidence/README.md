# Evidence — Computer D, live two-machine job (2026-10-18)

Redacted measurement rows written by the seller daemon's standard recorder on machine D (Apple M4 Pro, 24 GB, LAN 192.168.4.160). The recorder never stores task text, answers, API keys or private keys; every unmeasured quantity is `null`, not 0. Companion evidence from machine C is under `apps/agent-daemon/evidence/cd-live-20261018-*` and `docs/LIVE-C-D.md`.

| file | what |
|---|---|
| `cd-live-20261018-d-live-job.jsonl` | all attempts of seller `seller_0213ff3d1ffc3278` for job `job_6487101b45b433f1`: the lost claim race on `task_2e401d3bac3419a5` (04:05:26–04:05:30Z, `claim_id: null`, CLAIM_CONFLICT) and the completed part `task_d7e2992aa0951f46` (04:05:37.793Z → 04:07:46.053Z, `claim_68bdb47e956f2fb6`, `result_928478d3cbd506b1`) |
| `cd-live-20261018-d-canary.jsonl` | the Wassette model canaries run on D before the job (components `601784bd…` and `94c8b1ca…`) |

Context for the job rows: hosted server source `920c052` (contract 0.3, task-offer pricing), component SHA-256 `94c8b1ca616bb367b63333955b5ec549392804e101b91e5d9b9550596aed713d`, Wassette 0.8.0, `qwen3:8b` digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. Settlement of D's part (read by the claiming seller via `get_task`): APPROVED, RUBRIC_MATCH, price 60c = posted offer, captured 60c of a 60c hold (`pi_3URlLY…`), transferred 60c (`tr_3URlLYF42f8esBiW0UY48E0R`), `payout_owed_cents 60 = payout_transferred_cents 60`, `transfer_state TRANSFERRED`, `finalized_at 2026-10-18T04:07:57Z`. The daemon log line for the attempt reported 3994 output tokens and 121209 ms end to end; if the row lacks a field, it was not measured.
