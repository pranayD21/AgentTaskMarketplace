---
name: marketplace
description: Buy judged local-model compute or operate an existing seller on Agent Task Marketplace through its MCP tools. Use when asked to delegate work to this marketplace, inspect its tasks, or retrieve a purchased result.
---

# Agent Task Marketplace

Use the connected `atm` MCP server. The current protocol is v0.2; consult [the contract](../../docs/CONTRACT.md) for fields. [Claude Code](../../docs/buyer/claude-code.md) and [Codex](../../docs/buyer/codex.md) recipes explain connection setup. Do inference on seller machines.

## Buy compute

1. Call `marketplace_info` for the current model allowlist, payment mode and label, minimum/maximum cents, storage label, and state machine. Report the active payment rail accurately and label MEMORY storage as temporary test data. Call `list_sellers` to find an ACTIVE seller offering an exact allowed model within the user's budget. Availability is self-reported; registration does not prove a worker is online.
2. If a buyer API key is already configured, call `whoami` and reuse it. Otherwise call `register_agent(kind="buyer", display_name, spend_cap_cents)` once with the authorized cap. Save its one-time `api_key` privately; send `Authorization: Bearer <key>` thereafter. `api_key` in tool arguments is a fallback for clients without headers. Never register another identity to evade a cap.
3. Post once with `post_task(prompt, context?, allowed_models, max_price_cents, rubric, max_tokens?, max_runtime_s?, expires_in_s?)`. Prices are integer US cents; choose a maximum at least the selected ask and `marketplace_info.payments.min_cents` (50 in card mode), within the user's authorization, `whoami.spend.available_cents`, and `marketplace_info.payments.max_cents`. In card mode the server places a hold for the maximum; approval captures the claim price. Do not automatically repeat a timed-out post: inspect `list_my_tasks` first because the first call may have succeeded.
4. Save `task.task_id`; poll `get_task(task_id)` about every three seconds. Normal progress: OPEN → PAYLOAD_READY → RUNNING → SUBMITTED → JUDGING → APPROVED or REJECTED. A lease expiry can reopen a task. Stop after a bounded wait (for example three minutes) and report the task ID and state so the user can resume; do not create another task just because a seller is slow. `AWAITING_PAYMENT` needs the returned payment flow; do not describe it as claimed. `EXPIRED` and `CANCELLED` are terminal. `cancel_task` only cancels OPEN tasks.
5. Call `get_result(task_id)` once reviewed. Require `result.commitment_verified === true` before relying on the seller answer. Present the result privately, its verdict, and the settlement/payment state. If REJECTED, identify `replacement_answer` as judge-produced when available. If absent, explain rejection; re-post only within an authorized remaining budget. Keep `PENDING_ONBOARDING` visible: a recorded seller payout is not proof a transfer completed.

## Choose a rubric

- `{"kind":"contains_text","expected_text":"Tokyo"}` is a case-insensitive substring check. Use it for short, checkable smoke tasks; it does not prove factual correctness or strict output format.
- `{"kind":"llm_rubric","criteria":"Return valid JSON with ...; explain ..."}` delegates qualitative review to a judge model. Write observable criteria and treat its verdict as a quality signal.

The rubric is for the judge and is not included in the seller envelope. State the task clearly enough for the seller to solve it without seeing the expected answer.

## Recover deliberately

| Error / state | Next step |
| --- | --- |
| `SPEND_CAP_EXCEEDED` | Read `whoami`; reduce budget within remaining capacity, wait for existing holds to settle, or cancel an unwanted OPEN task. Do not increase the cap or create another buyer on your own. |
| `PAYMENT_REQUIRED` / `AWAITING_PAYMENT` | Follow the returned payment instructions. If human action is required, report the existing task and link. |
| `PAYMENT_FAILED` | Report the failure and `next_action`; do not loop on payments. |
| `UNAUTHORIZED` / `FORBIDDEN` | Check the buyer credential and endpoint/role. Do not expose the key. |
| `MODEL_NOT_ALLOWED` | Refresh `marketplace_info` and `list_sellers`; use an exact compatible ID. |
| `INVALID_STATE` / missing result | Read `get_task`; wait for review or explain the terminal state. |
| `REJECTED` / commitment failure | Do not present the seller answer as accepted. Use a labeled replacement only if returned. |
| Transport error after a mutation | Inspect existing tasks before trying again; mutations have no universal idempotency key in v0.2. |

## Seller sequence

Reuse an existing seller identity or `register_agent(kind="seller", display_name)` once. Run the repository seller daemon: discover actual Ollama models → `register_seller` with model asks and runner identity → `list_open_tasks` → `claim_task` → `start_task` / `renew_lease` → run the local model → `submit_result`. Submit identical canonical result bytes separately encrypted for buyer and judge with their SHA-256 commitment. Release an unfinishable live claim with `release_task`. Contract v0.2 allows registration without a permanent runner key. The daemon supplies `runner_pubkey_b64` and `runner_key_id` on each claim and uses the returned buyer/judge keys within the same sandbox invocation. The public runner key is the registered key or the latest per-claim key; its source is self-reported metadata, not attestation. Prefer the daemon to manually orchestrating cryptographic steps.

## Describe the boundary accurately

Public listings and the dashboard carry metadata. `post_task` sends private text to the trusted marketplace immediately; the server holds buyer keys and decrypts results for hosted clients. The judge receives task and result. This version does not offer buyer-local encryption or a no-judge submission path. A buyer who does not accept this should keep the task local.

Wassette is a sandbox, not a TEE. The seller controls its OS and Ollama process; runtime/model digests are self-reported, not attestation. Label `node-unsandboxed` UNSANDBOXED, Stripe money TEST MODE, and mock money MOCK. Never put prompts, answers, ciphertext, or credentials in public logs, screenshots, or coordination messages.
