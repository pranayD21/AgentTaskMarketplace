# Contract v0.3 — MCP tools, envelopes, states

This document defines the shared request, response and state-transition contract. Source of truth for schemas is `packages/shared/src/index.ts`; update this document and its consumers together when that contract changes.

## 1. Transport and auth

- The marketplace is an MCP server (streamable HTTP) at `<BASE_URL>/mcp` (local: `http://localhost:3000/mcp`). Inspector at `/mcp/inspector`. HTTP extras: `GET /health` (`{ok, contract, payments, db, base_url}`), `GET /api/dashboard`.
- Storage: Insforge Postgres. `DB_MODE=memory` runs the same tables in process for tests and offline development only; `/health.db`, `marketplace_info.storage` and the dashboard label it `MEMORY`.
- Every agent has an **API key** `atm_sk_…` issued once by `register_agent`. Send it as `Authorization: Bearer <key>` (or `X-Api-Key`). Clients that cannot set headers may pass `api_key` as a tool parameter. Only the sha256 of the key is stored.
- Actor kinds: `buyer`, `seller`, `judge`. Each tool lists who may call it. Judges need `JUDGE_REGISTRATION_SECRET` at registration.
- Errors are returned as MCP tool errors (`isError: true`) whose text is JSON: `{"error":{"code","message","retryable","next_action?"}}`. Codes and HTTP-equivalents: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `PAYMENT_REQUIRED` / `PAYMENT_FAILED` 402, `FORBIDDEN` 403, `SELLER_SUSPENDED` 403, `NOT_FOUND` 404, `SPEND_CAP_EXCEEDED` 409, `CLAIM_CONFLICT` 409, `MODEL_NOT_ALLOWED` 409, `INVALID_STATE` 409, `LEASE_EXPIRED` 410, `INTERNAL_ERROR` 500 (retryable).
- Successful results carry both `content[0].text` (pretty JSON) and `structuredContent` (same object).
- Amounts are integer **US cents, Stripe test mode**. Timestamps are ISO 8601 UTC. IDs are opaque (`task_…`, `claim_…`, `seller_…`, `buyer_…`, `judge_…`, `result_…`, `verdict_…`, `settle_…`).

## 2. State machine

```
AWAITING_PAYMENT ─(mpp paid)─▶ OPEN ─(claim_task)─▶ PAYLOAD_READY ─(start_task)─▶ RUNNING ─(submit_result)─▶ SUBMITTED ─(fetch_review_package)─▶ JUDGING ─(submit_verdict)─▶ APPROVED | REJECTED
   │                            │  ▲                    │                           │
   └─ deadline ─▶ EXPIRED       │  └── lease expired / release_task (before deadline) ◀┘
                                └─ deadline ─▶ EXPIRED ; cancel_task ─▶ CANCELLED
```

- `AWAITING_PAYMENT` only in `PAYMENT_MODE=mpp`. In `card` mode `post_task` places the hold and the task is `OPEN` immediately.
- `claim_task` is one atomic `UPDATE … WHERE status='OPEN'`; it writes claim fields **and** the seller envelope, so the task goes straight to `PAYLOAD_READY`. `CLAIMED` is reserved: it stays in the enum and in `ACTIVE_CLAIM_STATUSES` so a future two-step claim needs no client change, but the server never writes it.
- Active-claim states: `PAYLOAD_READY`, `RUNNING`. Lease 300 s; `renew_lease` extends by 300 s from now. A lapsed lease reopens the task (before the listing deadline) or expires it; the old seller envelope is deleted and a fresh claim gets a fresh envelope.
- `SUBMITTED` deletes the server's encrypted plaintext copy and the seller envelope. `JUDGING` stuck > 10 min goes back to `SUBMITTED`.
- Terminal: `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`. Exactly one settlement per task (unique `task_id`); `submit_verdict` is idempotent.
- Payment states on a task: `NONE`, `HELD`, `PAID` (MPP charge received), `CAPTURED`, `RELEASED`, `AWAITING_PAYMENT`, `MOCK`.

## 3. Tools

Optional `api_key` is accepted by every authenticated tool and omitted below.

| tool | actor | input | returns |
|---|---|---|---|
| `marketplace_info` | public | – | `contract_version`, payments mode/label/min_cents/max_cents, `storage`, identity status, allowlisted `models[]`, `task_states`, `lease_seconds`, `how_to_buy[]`, `how_to_sell[]`, `privacy` |
| `register_agent` | public | `kind`, `display_name` (≤80), `spend_cap_cents?` (buyers; default 2000), `judge_secret?` | `agent_id`, `kind`, **`api_key` (once)**, `spend_cap_cents`, `inkbox_handle`, `stripe{customer_id, connected_account_id}`, `notes[]`, `next` |
| `whoami` | any | – | `agent_id`, `kind`, `display_name`, `inkbox_handle`, buyers: `spend{cap,reserved,spent,available}_cents`, sellers: `seller{status,models,runtime,approvals,rejections,strikes}` |
| `list_sellers` | public | – | `sellers: SellerPublic[]` |
| `get_seller_reputation` | public | `seller_id` | `SellerPublic` |
| `expire_stale` | any | – | `{expired, reopened, requeued, failed}` (`failed`: tasks that errored this pass; retried next call) |
| `post_task` | buyer | `prompt` (≤20k), `context?` (≤60k), `allowed_models[]` (allowlisted), `max_price_cents` (≥ `min_cents`, 50 in card mode; ≤ 100 000), `max_runtime_s?` (180), `expires_in_s?` (3600), `rubric` (`{kind:"contains_text", expected_text}` or `{kind:"llm_rubric", criteria}`), `max_tokens?` (512) | `task: TaskPublic`, `payment_note`, `payment_label`, `next` |
| `list_my_tasks` | buyer | `status?` | `tasks: TaskPublic[]` (≤50, newest first) |
| `get_task` | buyer / claiming seller / judge | `task_id` | `task: TaskPublic`, `verdict?` (public fields), `settlement?` |
| `get_result` | buyer | `task_id` | `task`, `result?{result_id, model_id, runtime_ms, commitment_sha256, commitment_verified, answer, result_enc_buyer}`, `verdict?`, `replacement_answer?`, `settlement?`, `guidance` |
| `cancel_task` | buyer | `task_id` (OPEN only) | `task` (CANCELLED; hold released) |
| `register_seller` | seller | `models: ModelInfo[]` (`model_id`, `digest?`, `ask_cents` ≥ min), `runner_pubkey_b64?`, `runner_key_id?` (v0.2: both optional; omit them when every claim carries a per-claim key; a call replaces the previous registration, so omitting clears a registered key), `runner_wasm_sha256?`, `runtime` (`wassette` \| `node-unsandboxed`), `wassette_version?` | `seller: SellerPublic`, `next` |
| `list_open_tasks` | seller | `limit?` (1–100, default 50; oldest OPEN first) | `tasks: (TaskPublic & {eligible_models[]})[]`, `seller_models[]` |
| `claim_task` | seller | `task_id`, `model_id`, `runner_pubkey_b64?`, `runner_key_id?` (v0.2 per-claim key, see §7) | `claim: ClaimPublic` (`claim_id`, `task_id`, `seller_id`, `model_id`, `price_cents`, `lease_expires_at`, `seller_envelope`, `max_runtime_s`, `runner_key_id`, `runner_key_source`, `buyer_public_key`, `judge_public_key`), `next` |
| `get_recipient_keys` | seller (live claim) | `task_id`, `claim_id` | `buyer_public_key`, `judge_public_key` |
| `start_task` | seller | `task_id`, `claim_id` | `task` (RUNNING) |
| `renew_lease` | seller | `task_id`, `claim_id` | `lease_expires_at` |
| `release_task` | seller | `task_id`, `claim_id`, `reason` | `task` (OPEN or EXPIRED) |
| `submit_result` | seller | `task_id`, `claim_id`, `result_enc_buyer`, `result_enc_judge`, `commitment_sha256` (64 hex), `runtime_ms`, `tokens_out?` | `result_id`, `task` (SUBMITTED) |
| `fetch_review_package` | judge | – | `package: null \| {task_id, result_id, claim_id, seller_id, model_id, max_runtime_s, payload_enc_judge, result_enc_judge, commitment_sha256, buyer_public_key}`, `judge_key_id` |
| `submit_verdict` | judge | `task_id`, `result_id`, `verdict` (APPROVE/REJECT), `reason_code`, `reason_public` (≤400, no private text), `score?` (0–1), `replacement_enc_buyer?` | `idempotent`, `task`, `verdict{verdict_id?, verdict, reason_code}`, `settlement`, `seller_status` |

`reason_code` ∈ `RUBRIC_MATCH`, `RUBRIC_MISMATCH`, `COMMITMENT_MISMATCH`, `EMPTY_ANSWER`, `LLM_RUBRIC_PASS`, `LLM_RUBRIC_FAIL`, `JUDGE_ERROR`.

### Public objects
- `TaskPublic`: `task_id`, `buyer_id`, `allowed_models`, `max_price_cents`, `max_runtime_s`, `status`, `created_at`, `expires_at`, `claim_id`, `seller_id`, `model_id`, `price_cents`, `lease_expires_at`, `payment{mode, state, stripe_payment_intent_id, payment_link}`, `inkbox_context_id`. **Never** prompt, context, rubric or envelopes.
- `SellerPublic`: `seller_id`, `display_name`, `status`, `models[]`, `runner{public_key, key_source, wasm_sha256, runtime, wassette_version}`, `reputation{approvals, rejections, strikes}`, `inkbox_handle`, `last_seen`. `key_source` is `registered` (key from `register_seller`), `per-claim` (no registered key; `public_key` is the seller's latest per-claim key) or `none` (`public_key = {key_id:"none", public_key_b64:""}`).
- `ClaimPublic.runner_key_source`: `per-claim` when `claim_task` carried `runner_pubkey_b64`, else `registered`.

## 4. Keys and envelopes

- Algorithm `x25519-hkdf-xchacha20poly1305-v1`: ephemeral X25519 → shared secret → HKDF-SHA256 (salt = epk‖recipient pub, info `atm-envelope-v1`, 32 bytes) → XChaCha20-Poly1305 (24-byte nonce). Envelope: `{alg, recipient_key_id, epk_b64, nonce_b64, ct_b64}`. Decryption fails on wrong key or tampering.
- Key ids: `runner-<16 hex of sha256(pub)>`, `buyer-<…>`, `judge-<…>` (`JUDGE_KEY_ID` in env). The buyer's private key is **held by the server** (KEK-encrypted) so hosted clients can read answers via `get_result`.
- **Seller payload** (sealed to the runner key): `{task_id, claim_id, prompt, context?, max_tokens}`. **Judge payload** (sealed to the judge key at post time): `{task_id, prompt, context?, rubric}`. The seller never receives the rubric.
- **Result plaintext**: `{answer, task_id, claim_id, model_id, salt_b64}` (32 random salt bytes). Canonical JSON = keys sorted recursively, no whitespace, `undefined` dropped. `commitment_sha256` = sha256(canonical bytes). The **same bytes** are sealed separately to buyer and judge; both recompute the commitment before trusting the answer.
- `replacement_enc_buyer`: judge-produced `{answer, produced_by:"judge"}` sealed to the buyer.
- Server-side at rest: `plaintext_enc_server` = XChaCha20-Poly1305 under `SERVER_KEK_B64` of `{prompt, context, rubric, max_tokens}`; deleted on `SUBMITTED`, `EXPIRED`, `CANCELLED`.

## 5. Payments (card mode)

`post_task` → spend-cap check (`reserved + spent + max_price ≤ cap`) → Stripe manual-capture hold for `max_price_cents` → `payment.state = HELD`, buyer `reserved += max`. APPROVE → capture `price_cents` (remainder auto-released), transfer to the seller's connected account when possible, settlement `{seller_payout_cents: price, buyer_refund_cents: max − price}`, buyer `reserved −= max`, `spent += price`. REJECT / EXPIRED / CANCELLED → cancel the hold, settlement `{0, max}`, `reserved −= max`. Settlement `kind`: `STRIPE_TEST`, `MPP`, or `MOCK`, selected from the task’s payment mode. Seller payout not yet possible → `note` contains `PENDING_ONBOARDING`.

In MPP mode (Stripe test preview), posting creates `AWAITING_PAYMENT` and returns `/api/pay/<task_id>`. A POST without payment credentials returns HTTP 402. A successful Shared Payment Token charge opens the task with payment state `PAID`; approval refunds the unused budget and transfers the seller’s price, while rejection, cancellation and expiry refund the payment. See [payments setup](payments/README.md). Settlement always follows the task’s stored rail even when another server uses a different default. A failed payment operation leaves the task pending review and returns a retryable error; it does not publish a new verdict.

## 6. Runner component interface (`packages/runner-wasm/wit/world.wit`)

| export | input | output |
|---|---|---|
| `get-public-key` | – | JSON `KeyDescriptor` |
| `run-task` | `seller-envelope` (JSON Envelope), `opts` (JSON `{ollama_url, model_id, buyer_public_key, judge_public_key, timeout_ms?}`) | JSON `RunTaskOutput` or throws string |
| `judge-task` | `task-envelope`, `result-envelope`, `opts` (JSON `{buyer_public_key, commitment_sha256?, judge_model?, anthropic_url?}`) | JSON `JudgeTaskOutput` or throws string; REJECT `COMMITMENT_MISMATCH` when `commitment_sha256` differs from the decrypted bytes |
| `run-cycle` (v0.2, C) | `opts` (JSON `{marketplace_url, ollama_url, task_id, model_id, max_runtime_s, legacy_registration?}`) | JSON `{task_id, claim_id, result_id, runtime_ms, tokens_out?, key_id}`; on failure after the claim it calls `release_task` with a code-only reason and throws a code |
| `judge-cycle` (v0.2, E) | `opts` (JSON `{marketplace_url, judge_model?, anthropic_url?}`) | JSON `{idle:true}` or `{idle:false, task_id, result_id, verdict, reason_code, reason_public, score?, seller_status, seller_payout_cents, settlement_note}` |

`run-cycle` and `judge-cycle` call the marketplace from inside the sandbox with the same MCP streamable-HTTP tools as any agent (`packages/runner-core/src/marketplace.ts`). Errors cross the sandbox boundary as codes only.

Secrets inside the sandbox come from `wasi:config/store`, supplied by Wassette's env permission: seller `AGENT_API_KEY`; judge `AGENT_API_KEY`, `ANTHROPIC_API_KEY`, `JUDGE_PRIVATE_KEY_B64`. Network grants are full origins; Wassette 0.8 enforces scheme + hostname, not port (SECURITY.md). Wassette wraps results as `{"result": …}`; `result<string,string>` becomes `{ok}` / `{err}`.

## 7. v0.2 changes — ADOPTED

Needed for the sandbox fix: Wassette gives every component call a fresh instance, so the key that decrypts a claim must be generated in the same call that claims it.

1. **Adopted.** `claim_task` accepts optional `runner_pubkey_b64` (base64 of a 32-byte X25519 public key; anything else → `VALIDATION_ERROR` with `next_action`) and `runner_key_id` (default `runner-<16 hex of sha256(pubkey)>`, the same id `runner-core` produces). When present the seller envelope is sealed to that key instead of the registered one, and the key is stored on the task (`tasks.claim_runner_key_id`, `tasks.claim_runner_pubkey_b64`; cleared when the claim lapses or is released). `runner_key_id` without `runner_pubkey_b64` → `VALIDATION_ERROR`.
2. **Adopted.** `register_seller`: `runner_pubkey_b64` / `runner_key_id` are optional (validated the same way when sent). A seller with no registered key must present a per-claim key; `claim_task` without one → `INVALID_STATE` with a `next_action` naming `runner_pubkey_b64`. Sellers that register a key and claim without one (v0.1 daemons, `--runtime node`) keep working unchanged.
3. **Adopted.** The `claim_task` response adds `runner_key_id`, `runner_key_source` and `buyer_public_key` + `judge_public_key` (same values as `get_recipient_keys`, which stays for v0.1 clients), so the sandbox needs no second round trip.
4. **Adopted.** `SellerPublic.runner.public_key` falls back to the seller's latest per-claim key when no key is registered; `runner.key_source` says which (`registered` / `per-claim` / `none`). Stored as `sellers.last_claim_key_id` / `last_claim_pubkey_b64`.
5. **Landed (C `4cc4fb7`, E `b2f550e`/`5a56963`, on `main` since `bc05530`):** component exports `run-cycle(opts)` and `judge-cycle(opts)` do claim → decrypt → run → submit (resp. fetch → judge → submit) inside one instance. Their shapes are in §6.

Schema: the four new columns are `add column if not exists` lines at the end of `db/schema.sql`; the server also applies them itself on its first tool call (`src/db.ts` `ensureSchema`), so no manual migration is needed. `scripts/db-migrate.sh` still works.

Trust note (unchanged by v0.2, see SECURITY.md): the server cannot tell a key generated inside the sandbox from one generated by the host. A per-claim key fixes the per-call-instance problem; it is not attestation.

When A merges a contract change: A commits `docs/CONTRACT.md` + `packages/shared` on `main`, then posts the commit SHA and changed fields to every affected computer's inbound file.

---

# v0.3 additions — ADOPTED 2026-10-17 20:30 PDT (audit items J1–J3, P1/P2, F1, B1, I1)

Every v0.3 change is additive. A v0.2 client keeps working; the differences it can observe are listed under each item. **Implemented** on `claude/zen-mccarthy-0xradq`: §8–§9 at `9622d2d`, and §10–§12 at `62b0e46` (`CONTRACT_VERSION` 0.3). The deployed service runs it only after C merges and redeploys; check `/api/health.contract`.

New tools in v0.3: `fetch_replacement_package` and `submit_replacement` (judge); `create_job`, `get_job` and `list_my_jobs` (buyer). `post_task` adds `client_request_id`, `job_id`, `part_key` and `part_label`, and returns `idempotent`. `submit_verdict.reason_public` is optional and ignored. `expire_stale` also returns `resumed` and `transfers_retried`.

## 8. Judge outcomes (J1, J2, J3)

### 8.1 Public explanations (J1)
- The public explanation of a verdict is **chosen by the server from `reason_code`**, never copied from judge text. `PUBLIC_REASON` in `packages/shared` holds the text for each code (e.g. `RUBRIC_MISMATCH` → "The answer did not contain the buyer's expected text.").
- `submit_verdict.reason_public` is still accepted, so v0.2 judges don't break, but it is **neither stored nor published nor logged**. No field carries private judge reasoning; a judge that wants detail must keep it on its own machine.
- Every public surface uses the server text, **including verdict rows written before v0.3**: `get_task`, `get_result`, `/api/dashboard`, `list_sellers`/reputation and Inkbox verdict notices.

### 8.2 Judge infrastructure failures are retries, not verdicts (J2)
- Reason codes are split into two groups. **Quality:** `RUBRIC_MATCH`, `LLM_RUBRIC_PASS` (APPROVE only); `RUBRIC_MISMATCH`, `LLM_RUBRIC_FAIL`, `COMMITMENT_MISMATCH`, `EMPTY_ANSWER` (REJECT only). **Infrastructure:** `JUDGE_ERROR` (legacy), `JUDGE_UNAVAILABLE` (provider 5xx or unreachable), `JUDGE_TIMEOUT`, `JUDGE_MALFORMED` (unparseable grader output).
- `submit_verdict` with an infrastructure code, whatever `verdict` says, is a **deferral**. It writes no verdict, no settlement and no strike, and moves no money. The task goes back to `SUBMITTED` with `review.status = RETRY_PENDING`, `review.attempts += 1` and `review.retry_at = now + min(30 s × 2^(attempts−1), 10 min)`. The response is `{deferred: true, task, review}`. After 6 deferrals the status becomes `JUDGE_UNAVAILABLE`, and the task is still re-offered every 10 minutes. A later quality verdict settles normally, exactly once.
- `fetch_review_package` skips tasks whose `review.retry_at` is in the future.
- A quality code paired with the wrong `verdict` (e.g. APPROVE + `RUBRIC_MISMATCH`) → `VALIDATION_ERROR`.
- `TaskPublic.review`: `{status: "NOT_SUBMITTED" | "PENDING" | "RETRY_PENDING" | "JUDGE_UNAVAILABLE" | "FINAL", attempts, retry_at}`.

### 8.3 Replacement answers (J3)
- `TaskPublic.replacement_status`: `null` (no verdict yet) · `NOT_NEEDED` (APPROVED) · `PENDING` (REJECTED, judge answer not delivered yet) · `DELIVERED` · `UNAVAILABLE` (gave up after 5 attempts; the buyer was refunded in full either way).
- REJECT with `replacement_enc_buyer` → `DELIVERED`. REJECT without one, including every `COMMITMENT_MISMATCH` → `PENDING`.
- New judge tools:
  - `fetch_replacement_package()` atomically takes the oldest `PENDING` task whose `replacement_retry_at` has passed and leases it for 5 minutes. It returns `{package: null | {task_id, result_id, payload_enc_judge, buyer_public_key, attempts}}`.
  - `submit_replacement({task_id, result_id, replacement_enc_buyer?, reason_code?})`. With an envelope sealed to the buyer → `DELIVERED` (idempotent). Without one (provider down: send an infrastructure code) → `attempts += 1`, same backoff as 8.2, and `UNAVAILABLE` after 5 attempts. These tools never move money or change reputation.
- `get_result` adds `replacement_status` and returns `replacement_answer` only when `DELIVERED`. Its `guidance` says which case applies.

## 9. Durable settlement (P1, P2)

- A settlement row is created **before** money moves. It records the decision: `outcome` (`APPROVE` | `REJECT` | `CANCEL` | `EXPIRE`), `result_id`, `verdict_reason_code`, and the intended `seller_payout_cents` / `buyer_refund_cents`.
  - `state`: `PENDING` (decision recorded, money not confirmed) → `RECORDED` (money confirmed at Stripe; the v0.2 rows are all `RECORDED`).
  - `finalized_at` is set once every database effect has been applied: task status, buyer balance, seller reputation and the verdict row.
  - **Clients treat a settlement as final only when `finalized_at` is set.**
- Retrying `submit_verdict` for a task with a recorded decision follows that decision, whatever the new call says. The response is `{idempotent: true, resumed: <bool>}`. Housekeeping (`expire_stale`, and every sweep) resumes unfinished settlements older than 2 minutes.
- Exactly-once effects:
  - Stripe calls reuse the task-scoped idempotency keys `atm:<task>:capture|cancel|transfer`.
  - Buyer balance changes carry a key (`settle:<task>`, `reserve:<task>`, `unreserve:<task>`, `paid:<task>:<payment_intent>`), recorded in `agents.balance_keys` in the same compare-and-swap write. A monotonically increasing `balance_revision` guards against a balance returning to an earlier value.
  - Seller `approvals` / `rejections` / `strikes` are **recomputed** from final verdicts, not incremented. Infrastructure codes never count. `rejections` is lifetime; `strikes` counts only rejections after `sellers.reinstated_at`, which an operator sets when lifting a suspension (`apps/marketplace-mcp/scripts/reinstate-seller.mjs`). A seller is suspended when `strikes >= SUSPEND_AFTER_STRIKES` and stays suspended until reinstated.
- Durable posting: `atm_prepare_task` creates an unclaimable task (`AWAITING_PAYMENT`, payment state `POSTING`) and reserves the buyer/job budgets in one database transaction before calling the provider. An insert or budget-write failure rolls everything back, so it cannot orphan a hold. MPP listings reserve when paid.
- A card hold uses the stable task key `atm:<task>:hold`. Publication changes `post_state: HOLDING → READY` with a state guard. Unknown provider/database outcomes keep the task and reservation visible; housekeeping resumes the same post after two minutes. A duplicate request returns that task.
- Cancellation competes on the same state guard, closes the pending post first, then compensates its hold. Failed compensation stays `CANCEL_PENDING` with its reservation until recovery confirms release. Slow hold responses cannot reopen a cancelled task. Unknown holds older than 23 hours require operator reconciliation instead of replay beyond the provider's key-retention window.
- Seller transfers (P2):
  - The settlement adds `payout_owed_cents`, `payout_transferred_cents`, `transfer_state` (`NOT_APPLICABLE` | `PENDING` | `TRANSFERRED`), `transfer_attempts` and `transfer_retry_at`.
  - `PENDING` means the money is captured but not yet transferred. **Do not label it paid.**
  - The sweep takes a persisted five-minute lease with an ownership token before calling D's `retryTransfer(task, seller, amountCents, {attempt, known_transfer_id})`. Expired leases and unknown outcomes reuse the same payment key; stale workers cannot overwrite the new lease owner's result. Only a definitive provider rejection (`retry_safe_to_advance`) permits a fresh key attempt. Retry counts and payment-key attempts are separate.
  - Transfer amount, destination, currency and task group must match. `MISMATCH` sets `transfer_manual_review` and stops automatic retries. Unknown keys older than 23 hours also require reconciliation. `payout_transferred_cents` records the provider's confirmed amount.
  - An APPROVE whose transfer is pending is still `finalized_at` (the buyer side is complete). Only the transfer columns keep changing.

## 10. Jobs and parts (F1)

- A **job** groups the parts of one buyer request. Each part is an ordinary task with its own prompt, rubric, claim, result, verdict and settlement. **A job stores no private text.**
- `create_job({label_public?, budget_cents, client_job_key?})` (buyer) → `{job: JobPublic}`.
  - `label_public` (≤ 60 chars) **is public**: never put task content in it.
  - `budget_cents` must be ≤ the buyer's available cap. It is a ceiling, not a reservation.
  - The same `client_job_key` from the same buyer returns the existing job (`idempotent: true`).
- `post_task` adds optional fields:
  - `job_id`.
  - `part_key`: buyer-chosen, `[A-Za-z0-9._-]{1,64}`, public, unique per job among live attempts.
  - `part_label`: public, ≤ 60 chars.
  - `client_request_id`: `[A-Za-z0-9._-]{8,64}`, unique per buyer.
- Idempotent posting (also the fix for an ambiguous post, V1):
  - A `post_task` repeating a `client_request_id`, or a `job_id` + `part_key` whose latest attempt is not `REJECTED` / `EXPIRED` / `CANCELLED`, returns the existing task with `idempotent: true`. It places no new hold.
  - Re-posting a `part_key` whose latest attempt failed creates a new attempt (`attempt` = n+1). The new attempt counts against the job budget.
- Budget: a part reserves `max_price_cents` against **both** the buyer cap and the job budget (`jobs.reserved_cents + jobs.spent_cents + max ≤ budget_cents`), in the same transaction that creates the pending task. Over budget → `JOB_BUDGET_EXCEEDED` (409) with `next_action`.
- `get_job(job_id)` (buyer) → `{job, parts: (TaskPublic & {part_key, part_label, attempt})[], progress}`. `progress` = `{parts, approved, rejected, in_progress, open, failed_latest}` over the latest attempt of each `part_key`. `job.status` is derived:
  - `EMPTY`: no parts yet.
  - `IN_PROGRESS`: some part's latest attempt is not terminal.
  - `COMPLETE`: every part's latest attempt is APPROVED.
  - `PARTIAL_FAILURE`: all latest attempts are terminal and at least one is not APPROVED.
- `list_my_jobs()` (buyer) → `{jobs: JobPublic[]}`. `TaskPublic` adds `job_id`, `part_key`, `part_label`, `attempt` (null for standalone tasks). `/api/dashboard` adds `jobs: JobPublic[]` (no buyer secrets).
- `JobPublic`: `{job_id, buyer_id, label_public, budget_cents, reserved_cents, spent_cents, status, created_at, progress}`.
- Aggregation is done by the buyer (B): use only parts whose result is APPROVED with `commitment_verified: true`, and keep every failed part visible. The server does not combine answers.

## 11. Usage records for benchmarks (B1)

`UsageRecord` in `packages/shared` is one measured unit of work:

```
{schema: "atm.usage.v1", run_id, case_id, arm: "local" | "marketplace" | "baseline", component: "buyer" | "seller" | "judge" | "replacement" | "hosting" | "payment",
 task_id?, provider, model, model_version?, started_at, ended_at, latency_ms, load_ms?, input_tokens?, output_tokens?, cache_read_tokens?, cache_write_tokens?,
 retries, success, energy_wh?, energy_basis?: "measured" | "estimated", hardware?, cost_usd?, cost_basis?: "invoice" | "list_price" | "estimate", price_source?, price_date?, notes?}
```

Every quantity that was not measured is **`null`, never 0**. `cost_usd` is a resource cost. Marketplace prices and Stripe fees are recorded with `component: "payment"`, so buyer spend is never counted as a resource cost too (D reconciles). B owns the harness (`scripts/benchmarks/**`) and writes one JSON line per record.

## 12. Inkbox continuity (I1)

`tasks.inkbox_thread_owner` (the handle whose A2A context is `inkbox_context_id`) and `tasks.inkbox_buyer_context_id` persist what `inkbox.ts` held in memory. `inkbox.notify` receives and returns them, so a server restart between claim and verdict keeps both threads. E wires `inkbox.ts`; A adds the columns and passes them through.


## 13. Task offers (deployed, October 18 at 04:04 UTC)

The human assigned A and C work to C on October 17. This decision replaces seller ask pricing.

- `marketplace_info.pricing.mode` is `task_offer` when the implementation is available. Clients check the capability before registering a quote-free seller.
- `post_task.price_cents` is the posted offer in integer US cents. The deprecated `max_price_cents` alias accepts the same value; sending conflicting values is a validation error. The offer must fit the buyer and parent-job budgets. Posting reserves the full offer.
- `ModelInfo.ask_cents` is optional and deprecated. It has no effect on eligibility, claim price or settlement. Sellers advertise installed models and accept a task's offer by claiming it.
- `TaskPublic.price_cents` is populated before claim. Legacy unclaimed rows with a null price use their stored `max_price_cents`. Claims already accepted keep their stored price. Releasing a task preserves its offer. An approved task pays the accepted offer; a rejection releases the hold.
- `ClaimPublic.price_cents` is the price accepted by the claim. C's `expected_price_cents` is a local runtime check against this field, never a new MCP argument.
- Market observations group comparable model sets and runtime limits and include bounded sample counts, recent accepted prices, fill times and claim/expiry rates. Small samples are labelled insufficient. They are descriptive, do not establish an equilibrium and do not raise an offer or spending cap automatically.

Retry-key retention follows [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), checked October 17: v1 keys may be pruned after 24 hours; concurrent request conflicts and parameter mismatches cannot establish that an earlier operation failed. The service keeps the same key for those outcomes.


## 13. Human seller onboarding (2026-10-18)

New hosted sellers use the local installer. Existing saved C/D identities remain usable. `register_agent(kind=seller)` refuses new anonymous hosted registrations; memory/mock development keeps its fixture path.

- `GET /api/seller-auth-config` returns the public InsForge URL, Google provider and localhost callback address. No admin or anonymous key is included.
- The local Node server starts InsForge Google OAuth with PKCE, binds the callback to its browser session and a ten-minute state nonce, and exchanges the code in Node. Tokens never enter browser JavaScript or a saved file.
- `POST /api/seller/identity` takes a verified InsForge user bearer token and `{agent_key, display_name}`. The server verifies a real, email-verified Google user using InsForge `/api/auth/sessions/current`. The install generates and saves its random agent key before this request. Retrying the same key reuses the agent; another owner cannot take it over. The database stores only the key hash. The response includes agent ID, display name and verified owner metadata, never an agent key.
- `agents.owner_user_id` references `auth.users(id)`; `owner_email` is private. Row-level security denies direct browser access to the agents table. MCP/HTTP public projections omit ownership fields. Authenticated `whoami` includes the caller's owner and payout status.
- Human Stripe accounts are created without synthetic identity details. Their stable account request is persisted with first-attempt time, attempt count and retry time. D's policy allows three attempts, five-second backoff and a 20-hour window; unresolved outcomes then require reconciliation. No replacement identity is created to recover an unknown outcome.
- `get_seller_onboarding` requires a seller key and verified human link, and returns `payout_status`, `payout_onboarding_url`, `payout_label` and `blocking`. Connect links are single-use. `/seller/setup-return` and `/seller/setup-refresh` send the person back to their local dashboard; returning from Stripe is not proof of completion.
- Claims from human-owned sellers require an active Stripe transfer capability. Existing legacy workers keep their prior behavior. TEST MODE and MOCK remain explicit.
- `/api/seller-release` publishes contract 0.3, seller protocol 1, revision, supported models and SHA-256 checksums. Fixed artifact routes are `/install.sh`, `/seller-bundle.tgz`, `/runner.wasm`, `/runner.wasm.sha256`. Installers reject unavailable, dirty, incompatible or mismatched releases.
- The dashboard listens only on `127.0.0.1:43118`, requires a private launch token to establish an HttpOnly browser session, checks Host/Origin and rejects cross-origin actions. Hardware/Ollama stats are read locally. The worker service is disabled until Start selling; Stop selling disables automatic restart. Model preparation and identity checks run again at worker startup.

### Temporary dashboard marketplace-only dispatch (2026-10-18)

Dashboard chat posts every request directly as one task at 50 TEST cents, with a
10-minute listing lifetime and a 5-minute execution limit. It does not invoke a
local buyer model or generate a fallback answer. The selected model is the
worker's model, and need not be installed on the buyer's computer.

`post_task.marketplace_only` is optional for existing clients. When true, the
server stores the restriction with the encrypted task payload and enforces it
both in seller listings and at claim time: the seller must have a Google owner
different from the buyer's owner. Unlinked sellers cannot claim these tasks.
This distinguishes accounts; it does not attest physical machines.

The dashboard appends a completion-marker instruction and uses `contains_text`
acceptance. This verifies output format, not answer correctness. The marker is
removed from the displayed answer, which appears only after APPROVED status and
successful commitment verification. Existing payment readiness, account caps,
and the shared provider allowance still apply. Prompt, context, and grading
text follow their individual field limits. Network
retries use the same persisted client_request_id to avoid duplicate purchases.

### Dashboard output and task viewers (2026-10-18 follow-up)

A request may contain one to four self-contained tasks separated by `---TASK---`
on its own line. Multiple tasks share an idempotent job with a 50-cent-per-task
budget (at most 200 TEST cents). Each task retains its own idempotency key and
output. They are posted without waiting for previous tasks to finish; available
workers may run them concurrently. Shared provider and buyer limits still apply,
so posting later parts can fail without cancelling already posted parts.

SUBMITTED/JUDGING answers with verified commitments are now visible as pending
review. REJECTED output is labelled rejected. Only APPROVED output is presented
as final, and the request completes only when all tasks have approved results.
The completion marker remains a format check, not a correctness test.

Each confirmed claim opens an authenticated local task-progress tab on the buyer
computer. Task IDs and single-use viewer tokens are validated locally; no buyer
credentials reach the page. On installed seller workers, the existing Wassette
live viewer is enabled and opens in the default browser after a successful claim,
not on startup or failed claims. It shows local sandbox activity and model output;
submission is labelled as awaiting marketplace review. The buyer's viewer shows
remote task state/output, not remote CPU measurements. Existing remote installs
need the updated installer to enable their seller viewer; deployment cannot
restart or update another person's computer.
