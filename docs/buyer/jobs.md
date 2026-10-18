# One instruction, bounded independent parts

The buyer CLI partitions a list of independent records into balanced chunks, applies the same instruction to every chunk, and combines the verified records in their original order. This is useful for independent extraction, classification or per-record calculations. Cross-record reasoning, sequential dependencies and automatic LLM planning are outside this workflow.

Supply a private JSON file with `instruction`, `records` (2–100 objects with unique safe `id` values), and an explicit `rubric` or one rubric per part in `part_rubrics`. Optional `model` defaults to `qwen3:8b`; `max_tokens` defaults to 512. Each seller is instructed to return an array of `{id, output}` records. A rubric must check the intended work; a substring rubric does not prove arbitrary semantic correctness. Never put private content in record IDs, job names, or public labels.

```sh
# Input stays in an ignored/private location. Planning makes no network call.
node scripts/buyer.mjs job-plan .atm-state/input.json --name invoices --parts 2 --budget 200
node scripts/buyer.mjs job-run invoices --timeout 180
node scripts/buyer.mjs job-status invoices
# Private combined output; do not paste into public artifacts or recordings.
node scripts/buyer.mjs job-result invoices
```

The 200-cent total is divided into two 100-cent posted offers, rather than a 200-cent offer per part. Planning supports 2–20 parts. Every part must meet the discovered minimum; the server atomically enforces both the job budget and the existing buyer cap. Task offers are fixed on acceptance. Test payments are separate from external model API charges.

The workflow requires an existing buyer, the v0.3 job tools, idempotent posting and `pricing.mode=task_offer`. It never registers a new buyer or changes a cap. The private journal `.atm-state/jobs/<name>.json` contains the original endpoint, buyer binding, instruction, records, rubrics and request keys, and is written atomically with mode 0600 before posting. `ATM_JOB_DIR` can select another private state directory. Keep that journal and its original buyer credential to resume; do not regenerate keys after a timeout or overwrite an in-flight plan.

On restart, `job-run` reads `get_job`, reuses existing parts, and uses the same `client_request_id` for any uncertain post. Completed and failed parts are never automatically repurchased. A process lock prevents overlapping local runs; a dead process's lock can be recovered, while a live process's lock blocks a second run. A bounded wait leaves pending tasks intact. `AWAITING_PAYMENT` returns promptly for the existing payment flow.

`job-status` and `job-run` print only job/part IDs, seller IDs, states, budget and verification flags. `job-result` additionally returns private records only from original seller results that are APPROVED, commitment-verified, and contain exactly the expected unique record IDs with valid structure. Rejected, missing, malformed or unverified parts stay visible and are excluded. Judge replacements are labelled separately by `result`; they are not silently counted as the original seller's aggregate.

The dashboard groups current parts under safe parent IDs, showing actual seller identities, self-reported computer names, progress and budget. Its task window is bounded, so an older part may be missing from the visible rows while the server's parent totals still include it. A complete server job means all parts were approved; buyer aggregation separately checks commitments and result structure.
