# Contract v0.2 — MCP tools, envelopes, states

Computer **A** owns this file. B, C, D and E build against it. Propose a change in your directed message file to A (`coordination/messages/<you>-to-A.md`) before changing a shared request, response or state transition. Source of truth for schemas is `packages/shared/src/index.ts`; this document explains them.

## 1. Transport and auth

- The marketplace is an MCP server (streamable HTTP) at `<BASE_URL>/mcp` (local: `http://localhost:3000/mcp`). Inspector at `/mcp/inspector`. HTTP extras: `GET /health`, `GET /api/dashboard`.
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
- `claim_task` is one atomic `UPDATE … WHERE status='OPEN'`; it writes claim fields **and** the seller envelope, so the task goes straight to `PAYLOAD_READY` (`CLAIMED` is reserved).
- Active-claim states: `PAYLOAD_READY`, `RUNNING`. Lease 300 s; `renew_lease` extends by 300 s from now. A lapsed lease reopens the task (before the listing deadline) or expires it; the old seller envelope is deleted and a fresh claim gets a fresh envelope.
- `SUBMITTED` deletes the server's encrypted plaintext copy and the seller envelope. `JUDGING` stuck > 10 min goes back to `SUBMITTED`.
- Terminal: `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`. Exactly one settlement per task (unique `task_id`); `submit_verdict` is idempotent.
- Payment states on a task: `NONE`, `HELD`, `CAPTURED`, `RELEASED`, `AWAITING_PAYMENT`, `MOCK`.

## 3. Tools

Optional `api_key` is accepted by every authenticated tool and omitted below.

| tool | actor | input | returns |
|---|---|---|---|
| `marketplace_info` | public | – | payments mode/label/min_cents, identity status, allowlisted `models[]`, `task_states`, `lease_seconds`, `how_to_buy[]`, `how_to_sell[]`, `privacy` |
| `register_agent` | public | `kind`, `display_name` (≤80), `spend_cap_cents?` (buyers; default 2000), `judge_secret?` | `agent_id`, `kind`, **`api_key` (once)**, `spend_cap_cents`, `inkbox_handle`, `stripe{customer_id, connected_account_id}`, `notes[]`, `next` |
| `whoami` | any | – | `agent_id`, `kind`, `display_name`, `inkbox_handle`, buyers: `spend{cap,reserved,spent,available}_cents`, sellers: `seller{status,models,runtime,approvals,rejections,strikes}` |
| `list_sellers` | public | – | `sellers: SellerPublic[]` |
| `get_seller_reputation` | public | `seller_id` | `SellerPublic` |
| `expire_stale` | any | – | `{expired, reopened, requeued}` |
| `post_task` | buyer | `prompt` (≤20k), `context?` (≤60k), `allowed_models[]` (allowlisted), `max_price_cents` (≥ `min_cents`, 50 in card mode), `max_runtime_s?` (180), `expires_in_s?` (3600), `rubric` (`{kind:"contains_text", expected_text}` or `{kind:"llm_rubric", criteria}`), `max_tokens?` (512) | `task: TaskPublic`, `payment_note`, `payment_label`, `next` |
| `list_my_tasks` | buyer | `status?` | `tasks: TaskPublic[]` (≤50, newest first) |
| `get_task` | buyer / claiming seller / judge | `task_id` | `task: TaskPublic`, `verdict?` (public fields), `settlement?` |
| `get_result` | buyer | `task_id` | `task`, `result?{result_id, model_id, runtime_ms, commitment_sha256, commitment_verified, answer, result_enc_buyer}`, `verdict?`, `replacement_answer?`, `settlement?`, `guidance` |
| `cancel_task` | buyer | `task_id` (OPEN only) | `task` (CANCELLED; hold released) |
| `register_seller` | seller | `models: ModelInfo[]` (`model_id`, `digest?`, `ask_cents` ≥ min), `runner_pubkey_b64`, `runner_key_id`, `runner_wasm_sha256?`, `runtime` (`wassette` \| `node-unsandboxed`), `wassette_version?` | `seller: SellerPublic`, `next` |
| `list_open_tasks` | seller | – | `tasks: (TaskPublic & {eligible_models[]})[]`, `seller_models[]` |
| `claim_task` | seller | `task_id`, `model_id` **(v0.2 proposal: + `runner_pubkey_b64?`, `runner_key_id?` per-claim key — see §7)** | `claim: ClaimPublic` (`claim_id`, `task_id`, `seller_id`, `model_id`, `price_cents`, `lease_expires_at`, `seller_envelope`, `max_runtime_s`), `next` |
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
- `SellerPublic`: `seller_id`, `display_name`, `status`, `models[]`, `runner{public_key, wasm_sha256, runtime, wassette_version}`, `reputation{approvals, rejections, strikes}`, `inkbox_handle`, `last_seen`.

## 4. Keys and envelopes

- Algorithm `x25519-hkdf-xchacha20poly1305-v1`: ephemeral X25519 → shared secret → HKDF-SHA256 (salt = epk‖recipient pub, info `atm-envelope-v1`, 32 bytes) → XChaCha20-Poly1305 (24-byte nonce). Envelope: `{alg, recipient_key_id, epk_b64, nonce_b64, ct_b64}`. Decryption fails on wrong key or tampering.
- Key ids: `runner-<16 hex of sha256(pub)>`, `buyer-<…>`, `judge-<…>` (`JUDGE_KEY_ID` in env). The buyer's private key is **held by the server** (KEK-encrypted) so hosted clients can read answers via `get_result`.
- **Seller payload** (sealed to the runner key): `{task_id, claim_id, prompt, context?, max_tokens}`. **Judge payload** (sealed to the judge key at post time): `{task_id, prompt, context?, rubric}`. The seller never receives the rubric.
- **Result plaintext**: `{answer, task_id, claim_id, model_id, salt_b64}` (32 random salt bytes). Canonical JSON = keys sorted recursively, no whitespace, `undefined` dropped. `commitment_sha256` = sha256(canonical bytes). The **same bytes** are sealed separately to buyer and judge; both recompute the commitment before trusting the answer.
- `replacement_enc_buyer`: judge-produced `{answer, produced_by:"judge"}` sealed to the buyer.
- Server-side at rest: `plaintext_enc_server` = XChaCha20-Poly1305 under `SERVER_KEK_B64` of `{prompt, context, rubric, max_tokens}`; deleted on `SUBMITTED`, `EXPIRED`, `CANCELLED`.

## 5. Payments (card mode)

`post_task` → spend-cap check (`reserved + spent + max_price ≤ cap`) → Stripe manual-capture hold for `max_price_cents` → `payment.state = HELD`, buyer `reserved += max`. APPROVE → capture `price_cents` (remainder auto-released), transfer to the seller's connected account when possible, settlement `{seller_payout_cents: price, buyer_refund_cents: max − price}`, buyer `reserved −= max`, `spent += price`. REJECT / EXPIRED / CANCELLED → cancel the hold, settlement `{0, max}`, `reserved −= max`. Settlement `kind`: `STRIPE_TEST` or `MOCK`. Seller payout not yet possible → `note` contains `PENDING_ONBOARDING`.

## 6. Runner component interface (`packages/runner-wasm/wit/world.wit`)

| export | input | output |
|---|---|---|
| `get-public-key` | – | JSON `KeyDescriptor` |
| `run-task` | `seller-envelope` (JSON Envelope), `opts` (JSON `{ollama_url, model_id, buyer_public_key, judge_public_key, timeout_ms?}`) | JSON `RunTaskOutput` or throws string |
| `judge-task` | `task-envelope`, `result-envelope`, `opts` (JSON `{buyer_public_key, judge_model?, anthropic_url?}`) | JSON `JudgeTaskOutput` or throws string |

Secrets inside the sandbox come from `wasi:config/store` (`ANTHROPIC_API_KEY`, `JUDGE_PRIVATE_KEY_B64`), supplied by Wassette's env permission. Wassette wraps results as `{"result": …}`; `result<string,string>` becomes `{ok}` / `{err}`.

## 7. Proposed v0.2 changes (A decides; needed for the sandbox fix)

1. `claim_task` gains optional `runner_pubkey_b64` and `runner_key_id`. When present they override the registered runner key for this claim and are recorded on the claim. `register_seller` keeps `runner_pubkey_b64`/`runner_key_id` but they become optional when sellers always present per-claim keys.
2. `claim_task` response additionally returns `buyer_public_key` and `judge_public_key` (same as `get_recipient_keys`) to save the sandbox a round trip.
3. New component exports `run-cycle(opts)` and `judge-cycle(opts)` that perform claim → decrypt → run → submit (resp. fetch → judge → submit) **inside one instance**, calling the marketplace over wasi:http with the agent key from the env grant. Returns a JSON summary `{task_id, claim_id, result_id?, verdict?, runtime_ms}`.
4. `SellerPublic.runner.public_key` shows the last per-claim key id when present.

When A merges a contract change: A commits `docs/CONTRACT.md` + `packages/shared` on `main`, then posts the commit SHA and changed fields to every affected computer's inbound file.
