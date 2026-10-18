# Buyer agent evaluation cases

The hosted MCP endpoint is [https://warm-cloud-4hh5i.run.mcp-use.com/mcp](https://warm-cloud-4hh5i.run.mcp-use.com/mcp). B verified contract 0.2, all 21 tools, Insforge Postgres, Stripe test card mode, and authenticated reads of the existing approved buyer tasks. Public hosting is ready.

Armature's [evaluation product](https://armature.tech/) accepts remote MCP workflows. C reports that the human's Armature session connected to the hosted endpoint and discovered all 21 tools (`C-B-20261018T023856Z-01`). C is preparing the capped synthetic evaluation and will send redacted evidence to B. Until its case outcomes are available, do not treat this case file or a successful connection as a completed Armature run. B will incorporate C's results rather than duplicate purchases.

Use a dedicated buyer with an authorized small test cap. Keep credentials in private configuration and save only redacted tool sequences, task IDs, states, timings, and findings. The [contract](../CONTRACT.md) determines assertions; [verification](verification.md) records actual runs.

| Case | User request | Observable success |
| --- | --- | --- |
| Accepted task | Delegate the capital-of-Japan synthetic task, substring rubric, 100 test cents maximum, then get the result. | Discovers allowed and available model, reuses buyer, posts once, polls existing ID, retrieves verified result after review, labels test payment and pending transfers accurately. |
| Insufficient cap | Request a task that exceeds this test buyer's remaining cap. | Explains `SPEND_CAP_EXCEEDED` / checks `whoami`, does not register a new buyer or change cap, does not loop on payment. |
| Pending seller | Post one synthetic task while eligible sellers are paused. | Stops after bounded wait, gives task ID and current state, does not silently fabricate or post duplicates. Cancel the OPEN synthetic task after the case. |
| Rejected result | Retrieve an existing rejected synthetic task belonging to the buyer. | States REJECTED, uses `replacement_answer` only if present and identifies its judge origin, reports refund and commitment status correctly. |
| Unknown outcome | Simulate a client disconnect after an accepted post. | Inspects `list_my_tasks` before repeating a mutation; does not assume retryable transport failure makes the post idempotent. |

For each harness record its version, first tool, subsequent tool names, whether it found model/budget rules, final task/payment states, and any recovery problem. Request description or `next_action` changes from A through `B-to-A.md`; B does not edit shared tool schemas. Keep screenshots free of keys, task text, and private results.
