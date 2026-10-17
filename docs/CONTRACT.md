# Marketplace contract v0.1

Computer A owns changes to this contract. B, C, D, and E build against these names and state transitions. Propose a change in the directed file to A before changing a shared request or response. The HTTP API is JSON over `/v1`; `packages/contracts/` should contain machine-readable schemas and synthetic fixtures matching this document.

## Demo rules

- The API runs on A with FastAPI and one SQLite database. Other computers use `MARKETPLACE_BASE_URL`; they do not open A's database file.
- All amounts are nonnegative integer **mock credits**. The seeded buyer has a demo balance. No endpoint transfers money or submits a chain transaction.
- Timestamps are UTC RFC 3339 strings such as `2026-10-17T20:00:00Z`. IDs are opaque strings assigned by the API. Clients must not parse an ID to infer order or ownership.
- Public responses contain listing metadata only. The API accepts private task and result data as encrypted envelopes after a claim. It must not log ciphertext bodies, tokens, private keys, prompts, context, rubric, or result text.
- The local demo uses bearer tokens seeded outside Git. A token maps to one buyer, seller, judge, or operator actor. `Authorization: Bearer <token>` is required except for public reads marked below. This is demo access control on a trusted network, not production identity or transport security.
- Every mutating request requires a unique `Idempotency-Key` header. Replaying the same method, path, actor, key, and body returns the original response without a second side effect. Reusing the key with a different body returns `409 IDEMPOTENCY_CONFLICT`. A replay does not extend an old lease.

The judged workflow requires an explicit buyer choice. In v0.1, `judge_consent` must be `true` to create a job; a buyer who declines cannot submit that job through the judged marketplace flow. B must show this before posting. The judge receives a separate encrypted copy of task data and result only after the buyer has opted in. A buyer-controlled acceptance path without judge access is later work.

## Keys and private envelopes

D implements [libsodium sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes) using maintained Python bindings. Each endpoint holds its own private key outside Git. A public key descriptor is:

```json
{
  "key_id": "buyer-demo-key-1",
  "public_key_b64": "<base64 of a 32-byte public key>"
}
```

`key_id` is a stable identifier for that exact public key; the demo owner sets it when registering the key. An envelope is:

```json
{
  "alg": "crypto_box_seal-v1",
  "recipient_key_id": "seller-demo-key-1",
  "ciphertext_b64": "<base64 of the complete sealed box>"
}
```

Encode the UTF-8 JSON plaintext as one sealed box, then base64-encode the complete ciphertext with the standard alphabet. Do not add a separate nonce or write a custom cipher. Decryption must fail on a modified box or the wrong private key. Sealed boxes protect message integrity and the intended recipient, but they do not prove who encrypted the message; the API token authorizes who may upload it. A SHA-256 digest of ciphertext may be recorded for audit and retry checks. A hash is not encryption.

The buyer prepares two different plaintext objects. The seller copy contains `{"prompt":"...","context":"..."}`. The judge copy contains `{"prompt":"...","context":"...","rubric":{"kind":"contains_text","expected_text":"..."}}`. For v0.1, the judge checks whether the trimmed answer contains `expected_text`, ignoring case. The seller never receives the expected answer through the API.

The seller creates one result plaintext object with `answer`, `job_id`, `claim_id`, and `commitment_salt_b64` (32 fresh random bytes used only for the digest). D serializes that object as [RFC 8785 canonical JSON](https://www.rfc-editor.org/info/rfc8785/) UTF-8 bytes, computes lowercase hex SHA-256 of those bytes as `result_commitment_sha256_hex`, and encrypts the **same bytes** separately for buyer and judge. Both recipients hash their decrypted bytes before parsing and reject a mismatch. The judge uses only a matching result for its verdict. This binds the judge's answer to the buyer's answer. The digest is an integrity check, not secrecy or proof of which model ran.

The API may check recipient key IDs, ciphertext base64, size limits, and a ciphertext digest. It cannot inspect encrypted task or result text. B pins the full judge public key or its SHA-256 fingerprint in local configuration and rejects a different key from `GET /v1/keys/judge`; matching `key_id` alone is insufficient. The buyer key is frozen when the job is created. The seller key is frozen in the winning claim, even if the seller later updates registration. This demo trusts A to publish the correct buyer and seller keys. A compromised marketplace could substitute any recipient key and read or redirect private data. Encryption also cannot hide plaintext from a seller who controls its own inference process.

## Public objects and state

`JobPublic` has these fields and no private text or encrypted envelope:

| Field | Type | Rule |
| --- | --- | --- |
| `job_id` | string | API-generated. |
| `buyer_id` | string | Derived from the buyer token. |
| `allowed_model_ids` | string[] | Nonempty exact Ollama model IDs. |
| `max_price_credits` | integer | Maximum quote; reserved from buyer mock balance at creation. |
| `max_runtime_seconds` | integer | Positive seller execution limit; demo default 180. |
| `expires_at`, `created_at` | timestamp | Listing deadline and creation time. |
| `buyer_public_key` | key descriptor | Seller uses it to encrypt the result. |
| `judge_consent` | boolean | Explicitly `true` in v0.1. |
| `status` | enum | One of the job states below. |
| `settlement_state` | enum | `PENDING` until the one mock settlement is recorded, then `RECORDED`. |

`SellerPublic` has `seller_id`, `models` (each has an exact `model_id`, an integer `ask_credits`, and an optional self-reported `local_digest`), `public_key`, and `status` (`ACTIVE` or `SUSPENDED`). A model list or digest is a local observation, not remote model attestation. The seller must check local availability again before inference.

The normal job state path is `OPEN -> CLAIMED -> PAYLOAD_READY -> RUNNING -> SUBMITTED -> APPROVED|REJECTED`.

The result may move from `PAYLOAD_READY` directly to `SUBMITTED` if a worker omits the optional start call. A listing moves from `OPEN` to `EXPIRED` at its deadline. An active claim whose lease expires moves back to `OPEN` if the listing is still live; otherwise it moves to `EXPIRED`. Expiry or seller release invalidates that claim and its envelopes, including after payload upload. The buyer must encrypt and upload a fresh envelope for each new claim ID. An old seller may already have seen the original task, so expiry cannot revoke knowledge. Once a result is `SUBMITTED`, the lease no longer controls judgement or settlement. `APPROVED`, `REJECTED`, and `EXPIRED` are terminal in v0.1. A buyer retries a rejected job by creating a new job. Do not display a judge-produced replacement answer unless the judge actually ran and submitted one.

The first eligible claim committed by A's database wins. Eligibility means the seller is active, the chosen model ID is both in the seller's current registration and the job's allowlist, that model's registered `ask_credits` is at most `max_price_credits`, and the seller has no other active claim. An active claim is in `CLAIMED`, `PAYLOAD_READY`, or `RUNNING`; after `SUBMITTED`, the seller may claim another job. The claim locks the registered ask as `price_credits`; a later registration update cannot change that claim's price or public key. A claim lasts 300 seconds. A valid renewal sets `lease_expires_at` to 300 seconds after the server's current time. A lease cannot renew after expiry or after `SUBMITTED`. Every seller write after a claim carries `claim_id`; stale claims fail. The API uses its clock, not a client clock, for deadlines and leases.

## Endpoint contract

The API returns the named object directly as JSON. A list endpoint returns `{"items":[...]}`. All successful creates return `201`; successful reads and transitions return `200`. No route returns private plaintext.

| Method and path | Actor | Request | Response and rule |
| --- | --- | --- | --- |
| `GET /v1/keys/judge` | Public | None | Judge public key descriptor. B compares the full key or its fingerprint with the one pinned in demo configuration before encrypting. |
| `POST /v1/sellers` | Seller | `models` with `model_id` and `ask_credits`, `public_key` | `SellerPublic`. Same token can update its registration with a new idempotency key; changing a key or ask does not alter an active claim. |
| `GET /v1/sellers/{seller_id}/reputation` | Public | None | Approval/rejection counts and suspension state. |
| `POST /v1/jobs` | Buyer | `allowed_model_ids`, `max_price_credits`, `max_runtime_seconds`, `expires_at`, `buyer_public_key`, `judge_consent` | `JobPublic`. Reserves `max_price_credits` once or fails for insufficient mock balance. No prompt field is accepted. |
| `GET /v1/jobs?status=OPEN` | Public | Optional single `status` filter | `{"items":[JobPublic,...]}`. Never includes envelopes. |
| `GET /v1/jobs/{job_id}` | Public | None | `JobPublic` only. |
| `POST /v1/jobs/{job_id}/claim` | Seller | `model_id` | `Claim` with `claim_id`, `seller_id`, `model_id`, locked `price_credits`, `lease_expires_at`. Exactly one active claim per job. |
| `GET /v1/jobs/{job_id}/assignment` | Buyer or active seller | None | Current `Claim` plus seller public key. Buyer uses it for the private handoff. |
| `POST /v1/jobs/{job_id}/lease/renew` | Active seller | `claim_id` | Updated `Claim`; only while `CLAIMED`, `PAYLOAD_READY`, or `RUNNING`. |
| `POST /v1/jobs/{job_id}/release` | Active seller | `claim_id`, `reason_code` | Updated `JobPublic`; allowed before `SUBMITTED`, invalidates the claim and its envelopes, and reopens if before listing deadline. No payout. |
| `POST /v1/jobs/{job_id}/payload` | Buyer | `claim_id`, `seller_envelope`, `judge_envelope` | `JobPublic` in `PAYLOAD_READY`. Only after a live claim; each envelope key ID must match its intended recipient. |
| `GET /v1/jobs/{job_id}/payload` | Active seller | None | `claim_id` and `seller_envelope` only. Judge data is excluded. |
| `POST /v1/jobs/{job_id}/start` | Active seller | `claim_id` | `JobPublic` in `RUNNING`. Optional; useful for UI. |
| `POST /v1/jobs/{job_id}/result` | Active seller | `claim_id`, `model_id`, `buyer_envelope`, `judge_envelope`, `runtime_ms`, `result_commitment_sha256_hex` | `result_id` and `JobPublic` in `SUBMITTED`. The selected model ID must match the claim. |
| `GET /v1/jobs/{job_id}/result` | Buyer | None | `result_id`, `model_id`, `buyer_envelope`, and `result_commitment_sha256_hex`. |
| `GET /v1/jobs/{job_id}/review-package` | Judge | None | `claim_id`, `result_id`, `task_judge_envelope`, `result_judge_envelope`, and `result_commitment_sha256_hex`. Available only after submission and buyer consent. |
| `POST /v1/jobs/{job_id}/judgement` | Judge | `claim_id`, `result_id`, `verdict`, `reason_code`, `reason` | `verdict_id` and updated `JobPublic`. `verdict` is `APPROVE` or `REJECT`. The public reason must not quote private task or result text. |
| `GET /v1/jobs/{job_id}/judgement` | Buyer, seller, or judge | None | Verdict ID, verdict, reason code, public reason, and timestamp. |
| `POST /v1/jobs/{job_id}/settlement` | Judge or operator | `verdict_id` for a judged job, or `expiry: true` for an `EXPIRED` job | One `MockSettlement` derived by the API/payment module from verdict or expiry, reserved maximum, and accepted claim price. Client cannot choose the payout amount. |
| `GET /v1/jobs/{job_id}/settlement` | Buyer, winning seller, or judge | None | `MockSettlement` once recorded. |
| `GET /v1/accounts/me/mock-balance` | Buyer or seller | None | `available_credits` and `reserved_credits`, labeled as mock credits. |
| `POST /v1/sellers/{seller_id}/suspension` | Operator | `suspended`, `reason_code`, `evidence_ref` | Updated `SellerPublic`. This is reversible and needs operator review of a confirmed malicious act. A rejected answer alone cannot call this route. |

The `Claim` response does not include a private payload. Only the buyer who created a job can upload its envelopes. Only the winning seller can fetch its envelope or submit a result. The judge can read a review package only for a consented job. A seller's published key must stay fixed for the life of an active claim; a new registration key applies to later claims.

## Mock credit ledger

E owns the payment rule in `apps/payments/`; A exposes the endpoint and calls that module during integration. A's idempotent local seed creates `buyer_demo` with 100 mock credits and `seller_demo` with 0; the initial buyer balance is configured as `DEMO_BUYER_INITIAL_CREDITS=100`. Creating a job moves `max_price_credits` from the buyer's available balance into reserve. If the available balance is too low, the API returns `409 INSUFFICIENT_MOCK_CREDITS` and creates neither job nor reserve. Claim retries keep the reserve. An approved verdict pays the accepted `price_credits` to the seller and refunds `max_price_credits - price_credits` to the buyer. A rejected verdict or final job expiry refunds the entire reserve. A marks an unclaimed job `EXPIRED` at its listing deadline, or after a failed lease if that deadline has passed. A valid active claim can finish after the listing deadline. E calls the settlement endpoint for an `EXPIRED` job with `{"expiry":true}` and no `verdict_id`. That call is idempotent under the same rules as judged settlement. Each job has at most one final settlement. A repeated settlement call returns the same record and makes no second ledger entry.

`MockSettlement` contains `settlement_id`, `job_id`, `verdict_id` (null only for expiry), `kind: "MOCK_CREDITS"`, `state: "RECORDED"`, `seller_payout_credits`, `buyer_refund_credits`, and `recorded_at`. A rejection records `seller_payout_credits: 0`. An expired job has the same zero-payout rule. A judge verdict updates reputation once; repeating the verdict does not add another approval or rejection. The seller reputation view reports counts, not a claim that the seller acted maliciously.

## Example exchange

These snippets show the field names. Key and ciphertext strings are placeholders, not usable secrets. Every `POST` also sends `Authorization` and a fresh `Idempotency-Key` header.

```http
POST /v1/jobs
Content-Type: application/json

{"allowed_model_ids":["qwen2.5:7b"],"max_price_credits":8,"max_runtime_seconds":180,"expires_at":"2026-10-17T21:00:00Z","buyer_public_key":{"key_id":"buyer-demo-key-1","public_key_b64":"<base64-public-key>"},"judge_consent":true}
```

```json
{
  "job_id": "job_demo_1",
  "buyer_id": "buyer_demo",
  "allowed_model_ids": ["qwen2.5:7b"],
  "max_price_credits": 8,
  "max_runtime_seconds": 180,
  "expires_at": "2026-10-17T21:00:00Z",
  "created_at": "2026-10-17T20:00:00Z",
  "buyer_public_key": {"key_id":"buyer-demo-key-1","public_key_b64":"<base64-public-key>"},
  "judge_consent": true,
  "status": "OPEN",
  "settlement_state": "PENDING"
}
```

The seller registers its locally observed model and then claims:

```json
{"models":[{"model_id":"qwen2.5:7b","ask_credits":6,"local_digest":"<optional-local-digest>"}],"public_key":{"key_id":"seller-demo-key-1","public_key_b64":"<base64-public-key>"}}
```

```http
POST /v1/jobs/job_demo_1/claim
Content-Type: application/json

{"model_id":"qwen2.5:7b"}
```

```json
{"claim_id":"claim_demo_1","seller_id":"seller_demo","model_id":"qwen2.5:7b","price_credits":6,"lease_expires_at":"2026-10-17T20:06:00Z"}
```

The buyer fetches the assignment and uploads two separate boxes. The API stores them without decrypting them:

```json
{"claim_id":"claim_demo_1","seller_envelope":{"alg":"crypto_box_seal-v1","recipient_key_id":"seller-demo-key-1","ciphertext_b64":"<sealed-task-for-seller>"},"judge_envelope":{"alg":"crypto_box_seal-v1","recipient_key_id":"judge-demo-key-1","ciphertext_b64":"<sealed-task-and-rubric-for-judge>"}}
```

The seller submits two result boxes, then the judge posts a verdict:

```json
{"claim_id":"claim_demo_1","model_id":"qwen2.5:7b","buyer_envelope":{"alg":"crypto_box_seal-v1","recipient_key_id":"buyer-demo-key-1","ciphertext_b64":"<sealed-result-for-buyer>"},"judge_envelope":{"alg":"crypto_box_seal-v1","recipient_key_id":"judge-demo-key-1","ciphertext_b64":"<sealed-result-for-judge>"},"runtime_ms":2200,"result_commitment_sha256_hex":"<64 lowercase hex characters>"}
```

```json
{"claim_id":"claim_demo_1","result_id":"result_demo_1","verdict":"APPROVE","reason_code":"RUBRIC_MATCH","reason":"The answer met the buyer's check."}
```

E calls `POST /v1/jobs/job_demo_1/settlement` with `{"verdict_id":"verdict_demo_1"}`. This approved example pays 6 mock credits to the seller and refunds 2 to the buyer. A rejected verdict pays 0 and refunds 8. A judge-produced replacement is a separate execution, not an implied result of rejection.

## Errors and retry behavior

All errors use `{"error":{"code":"...","message":"...","retryable":false}}`. The message is safe for logs and must not echo private text or tokens.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing, malformed, unsupported, or oversize field. |
| 401 | `UNAUTHORIZED` | Missing or invalid token. |
| 403 | `FORBIDDEN` | Actor lacks access to this job or envelope. |
| 409 | `INSUFFICIENT_MOCK_CREDITS` | Buyer cannot reserve the maximum price. The API creates no job or reserve. |
| 404 | `NOT_FOUND` | Unknown job, seller, or result. |
| 409 | `CLAIM_CONFLICT` | Another valid claim won or seller already has an active claim. |
| 409 | `MODEL_NOT_ALLOWED` | Model absent from either allowlist or seller registration, or quote exceeds budget. |
| 409 | `INVALID_STATE` | Operation is valid in another job state. |
| 409 | `IDEMPOTENCY_CONFLICT` | Same idempotency key reused with a different body. |
| 410 | `LEASE_EXPIRED` | Claim ID was valid but its lease is over or replaced. |
| 500 | `INTERNAL_ERROR` | Server failure; client may retry with the same idempotency key. |

Clients can retry a timed-out mutating call with the same idempotency key. For a new attempt after an explicit conflict, they must read the current job first and use a new key. An expired seller must stop work and cannot reuse a stored payload for a new claim. A lease renewal, result submission, verdict, and settlement each need tests for duplicate delivery.
