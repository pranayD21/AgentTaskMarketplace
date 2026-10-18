# Buyer agent evaluation cases

Use the real hosted MCP URL once A publishes it. Armature's [evaluation product](https://armature.tech/) accepts remote MCP workflows; sign in at [Armature](https://app.armature.tech/) using the team's human account. Hosted setup is blocked until an account session and reachable URL exist. Do not treat this case file as a completed Armature run.

Use a dedicated buyer with an authorized small test cap. Keep credentials in private configuration and save only redacted tool sequences, task IDs, states, timings, and findings. The [contract](../CONTRACT.md) determines assertions; [verification](verification.md) records actual runs.

| Case | User request | Observable success |
| --- | --- | --- |
| Accepted task | Delegate the capital-of-Japan synthetic task, substring rubric, 100 test cents maximum, then get the result. | Discovers allowed and available model, reuses buyer, posts once, polls existing ID, retrieves verified result after review, labels test payment and pending transfers accurately. |
| Insufficient cap | Request a task that exceeds this test buyer's remaining cap. | Explains `SPEND_CAP_EXCEEDED` / checks `whoami`, does not register a new buyer or change cap, does not loop on payment. |
| Pending seller | Post one synthetic task while eligible sellers are paused. | Stops after bounded wait, gives task ID and current state, does not silently fabricate or post duplicates. Cancel the OPEN synthetic task after the case. |
| Rejected result | Retrieve an existing rejected synthetic task belonging to the buyer. | States REJECTED, uses `replacement_answer` only if present and identifies its judge origin, reports refund and commitment status correctly. |
| Unknown outcome | Simulate a client disconnect after an accepted post. | Inspects `list_my_tasks` before repeating a mutation; does not assume retryable transport failure makes the post idempotent. |

For each harness record its version, first tool, subsequent tool names, whether it found model/budget rules, final task/payment states, and any recovery problem. Request description or `next_action` changes from A through `B-to-A.md`; B does not edit shared tool schemas. Keep screenshots free of keys, task text, and private results.
