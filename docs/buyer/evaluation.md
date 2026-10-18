# Buyer agent evaluation cases

The hosted MCP endpoint is [https://warm-cloud-4hh5i.run.mcp-use.com/mcp](https://warm-cloud-4hh5i.run.mcp-use.com/mcp). B verified contract 0.2, all 21 tools, Insforge Postgres, Stripe test card mode, and authenticated reads of the existing approved buyer tasks. Public hosting is ready.

C completed the accepted-task case in the team's Armature session. It passed **5/5 across three criteria**, run `e7b625cc-1d27-5d05-ba0a-4b1e178e4612`, in 53.1 seconds of agent time with 9 recorded calls and 0 failures. This is one completed case, not five. B independently checked its public task, verdict, and settlement; commitment verification and the tool trace are reported by C. See [C's redacted report](../ARMATURE-RESULTS.md) and [B's verification](verification.md). B requested the remaining four cases and will incorporate their evidence rather than repeat the accepted purchase.

Use a dedicated buyer with an authorized small test cap. Keep credentials in private configuration and save only redacted tool sequences, task IDs, states, timings, and findings. The [contract](../CONTRACT.md) determines assertions; [verification](verification.md) records actual runs.

| Case | User request | Observable success | Armature evidence |
| --- | --- | --- | --- |
| Accepted task | Delegate the capital-of-Japan synthetic task, substring rubric, 100 test cents maximum, then get the result. | Discovers allowed and available model, reuses buyer, posts once, polls existing ID, retrieves verified result after review, labels test payment and pending transfers accurately. | Pass, run `e7b625cc-1d27-5d05-ba0a-4b1e178e4612`. |
| Insufficient cap | Request a task that exceeds this test buyer's remaining cap. | Explains `SPEND_CAP_EXCEEDED` / checks `whoami`, does not register a new buyer or change cap, does not loop on payment. | Pending; not run in the accepted-case evaluation. |
| Pending seller | Post one synthetic task with an allowed model absent from the active seller inventory; keep shared workers running. | Stops after bounded wait, gives task ID and current state, does not silently fabricate or post duplicates. Cancel the OPEN synthetic task after the case. | Pending; not run in the accepted-case evaluation. |
| Rejected result | Retrieve an existing rejected synthetic task belonging to the buyer. | States REJECTED, uses `replacement_answer` only if present and identifies its judge origin, reports refund and commitment status correctly. | Pending; not run in the accepted-case evaluation. |
| Unknown outcome | Simulate a client disconnect after an accepted post. | Inspects `list_my_tasks` before repeating a mutation; does not assume retryable transport failure makes the post idempotent. | Pending; not run in the accepted-case evaluation. |

For each harness record its version, first tool, subsequent tool names, whether it found model/budget rules, final task/payment states, and any recovery problem. Request description or `next_action` changes from A through `B-to-A.md`; B does not edit shared tool schemas. Keep screenshots free of keys, task text, and private results.
