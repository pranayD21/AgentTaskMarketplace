# Payments — Stripe test mode, two rails

The payment implementation is in `apps/marketplace-mcp/src/payments.ts`, `src/mpp.ts`, and `src/mpp-routes.ts`. Everything below is **Stripe test mode**; the server refuses to start with a live key. Amounts are integer US cents.

| | `PAYMENT_MODE=card` (default, GA APIs) | `PAYMENT_MODE=mpp` (showcase, preview APIs) |
|---|---|---|
| Who pays | The marketplace charges a test card the buyer agent registered with | **The buyer agent pays from its own wallet**: HTTP 402 Machine Payments Protocol challenge, settled with a Stripe Link Shared Payment Token |
| Human control | `spend_cap_cents` set at `register_agent`; `post_task` refuses to exceed `reserved + spent + max ≤ cap` | Same cap **plus** a human approves each spend request in the Link app (per-transaction and daily limits live in Link) |
| At `post_task` | PaymentIntent **hold** (`capture_method=manual`) for `max_price_cents`; task `OPEN`, `payment.state=HELD` | Task `AWAITING_PAYMENT` with `payment.payment_link`; nothing charged yet |
| Paying | – | `POST <payment_link>` → `402` + `WWW-Authenticate: Payment …`; wallet retries with `Authorization: Payment …` (SPT) → mppx creates + confirms a PaymentIntent for `max_price_cents` → task `OPEN`, `payment.state=PAID` |
| APPROVE | capture `price_cents` of the hold (rest auto-released) → **transfer** `price_cents` to the seller's connected account | **refund** `max − price` to the buyer → transfer `price_cents` to the seller |
| REJECT / cancel / expiry | cancel the hold | full refund |
| Seller payout | Stripe Connect **Accounts v2** recipient account, `stripe_transfers` capability | same |

## Stripe objects created, step by step

| step | object | where to see it |
|---|---|---|
| `register_agent(kind=buyer)` (card mode) | Customer `cus_…` with `pm_card_visa` attached as default | [Customers](https://dashboard.stripe.com/test/customers) |
| `register_agent(kind=seller)` / `register_seller` | **v2 recipient account** `acct_…` (`/v2/core/accounts`, `configuration.recipient`, `dashboard: none`); `stripe_transfers` is **active immediately** in test mode | [Connected accounts](https://dashboard.stripe.com/test/connect/accounts/overview) |
| `post_task` (card) | PaymentIntent `pi_…` `requires_capture` for `max_price_cents`, `transfer_group = task_id` | [Payments](https://dashboard.stripe.com/test/payments) — shows as *Uncaptured* |
| `POST /api/pay/<task>` (mpp) | PaymentIntent `pi_…` `succeeded`, created by mppx from the SPT, metadata `task_id`, `mpp_challenge_id`, `machine_payment=true` | Payments |
| `submit_verdict` APPROVE (card) | capture → Charge `ch_…` for `price_cents`; Transfer `tr_…` to `acct_…` with `source_transaction = ch_…` | Payments → the charge; [Transfers](https://dashboard.stripe.com/test/connect/transfers); the connected account's balance |
| `submit_verdict` APPROVE (mpp) | Refund `re_…` for `max − price`; Transfer `tr_…` | Payments → the payment shows *Partially refunded*; Transfers |
| REJECT / `cancel_task` / expiry | card: PaymentIntent `canceled`; mpp: Refund `re_…` for the full amount | Payments |

Every id is recorded on the task (`payment.stripe_payment_intent_id`) and the settlement (`stripe_capture_id`, `stripe_transfer_id`, `note`), visible through `get_task` / `get_result` and `GET /api/dashboard`.

## Seller payouts (Accounts v2)

Stripe rejects new Accounts v1 `type=custom` integrations, so sellers get a **v2 core account** with the recipient configuration. A bare account reports `stripe_transfers.status = restricted` with these requirements:

```
defaults.profile.business_url
identity.entity_type
identity.attestations.terms_of_service.account.date
identity.attestations.terms_of_service.account.ip
external_account                      ← restricts stripe_balance.payouts only, not transfers
```

`createRecipientAccount` now supplies all of them at creation: `entity_type: individual`, an `individual` block made of Stripe's documented **test-mode verification values** (DOB `1901-01-01`, `us_ssn_last_4 = 0000`, address line `address_full_match`), the ToS attestation, and a profile URL. The capability is `active` in the create response and `transfers.create` succeeds (with `source_transaction` set to the buyer's charge so no platform balance is needed).

Restricted accounts are repaired lazily: `ensureTransfersActive` runs before every transfer, updates the account in place with the same identity when it is still restricted, and polls the capability (5 × 1 s). If it is still not active the settlement note says `transfer PENDING_ONBOARDING: …` and the task still settles.

The identity is synthetic (it is tagged `synthetic_identity: stripe-test-mode-values` in the account metadata) and would be rejected in live mode. A real deployment collects the seller's own details through the hosted Connect flow — `onboardingLink(stripe, accountId, baseUrl)` in `payments.ts` creates that `v2.core.accountLinks` URL — and would keep the ToS attestation from the seller's real request (IP, user agent). `external_account` stays open on purpose: it only gates bank payouts from the connected account, which the demo does not do.

## MPP mode (preview) — how it is wired

- `src/mpp.ts`: `StripeMppProvider implements PaymentProvider`. `hold()` returns `AWAITING_PAYMENT` + `payment_link = ${BASE_URL}/api/pay/<task_id>`. `capture()` refunds the remainder and transfers; `release()` refunds in full. `payTask()` drives mppx; `markTaskPaid()` flips `AWAITING_PAYMENT → OPEN` atomically, sets `payment_state = PAID`, records the PaymentIntent, bumps the buyer's `reserved_cents`, logs `task.paid`.
- `src/mpp-routes.ts`: `POST|GET /api/pay/:task_id` (registered from `routes.ts`). In card/mock mode it answers `409` with a message instead of `404`.
- mppx 0.13.5: `stripe.charge({ client, networkId: STRIPE_PROFILE_ID, currency: "usd", decimals: 2, paymentMethodTypes: ["card","link"], connect: ({request}) => ({ transferGroup: request.externalId }) })`, `Mppx.create({ methods, secretKey, realm })`, `mppx.charge({ amount: "1.00", externalId: task_id, … })(request)` → `result.challenge` (the 402 `Response`) or `result.withReceipt(Response)`. The `Payment-Receipt` header carries the PaymentIntent id (`reference`). The challenge is HMAC-bound to `externalId = task_id`, so a credential cannot be replayed against another task; mppx also uses `mpp_<challenge>_<spt>` as the Stripe idempotency key.
- Env: `STRIPE_PROFILE_ID` (`profile_test_…`, the Stripe Business Network profile; it is the `networkId` the wallet sees) is required in mpp mode. `MPP_SECRET_KEY` (≥ 32 bytes, HMAC for challenge ids) is optional; when unset it is derived as `sha256("atm-mpp-challenge-hmac:" + SERVER_KEK_B64)`.
- Minimum charge is 50c (Stripe card minimum; mppx withholds the offer below it).

### Test it without a phone (simulated Shared Payment Token)

```sh
PAYMENT_MODE=mpp pnpm dev:server --no-open                    # or PORT=3001 BASE_URL=http://localhost:3001 … to run beside a card-mode server
node docs/payments/simulate-spt.mjs --max 100                    # MARKETPLACE_URL=http://localhost:3001/mcp if you changed the port
```

Manual equivalents:

```sh
curl -i -X POST http://localhost:3001/api/pay/<task_id>            # 402 + WWW-Authenticate: Payment …
curl -s http://localhost:3001/openapi.json | jq .                   # MPP discovery document (x-payment-info)
export MPPX_STRIPE_SECRET_KEY=sk_test_…                             # lets the validator pay the challenge itself (test mode)
npx mppx@0.13.5 validate http://localhost:3001 --endpoint POST:/api/pay/<task_id>   # protocol conformance + a real test-mode roundtrip
```

### The showcase: a buyer agent paying with the Link agent wallet

The human half of the Stripe track story. Needs a US Link account on the human's phone.

```sh
npm i -g @stripe/link-cli                       # 0.28.0
link-cli auth login --client-name "Claude Code" # approve on the phone
link-cli user-info retrieve                     # shows per-transaction / daily limits
link-cli approval-policy retrieve               # what needs explicit approval
```

Register it as an MCP server next to the marketplace in Claude Code (`~/.claude.json` or `claude mcp add`):

```json
{ "mcpServers": { "link": { "command": "npx", "args": ["@stripe/link-cli", "--mcp"] } } }
```

Then the agent, in one conversation:

1. `post_task(…)` on the marketplace (server in `PAYMENT_MODE=mpp`) → gets `payment.payment_link`.
2. `link-cli mpp pay <payment_link> --method POST --test --context "Buying 100c of sandboxed qwen3:8b compute on the Agent Task Marketplace for task …"` — the CLI probes the link, decodes the `WWW-Authenticate` challenge (`link-cli mpp decode --challenge '…'` shows it), creates a **spend request** for a Shared Payment Token on the `profile_test_…` network, the **human approves it on their phone**, and the CLI retries the request with the credential. (`spend-request create --credential-type shared_payment_token --network-id profile_test_… --test --request-approval` is the explicit form; `mpp pay` wraps it.)
3. `get_task` → `OPEN`, `payment.state=PAID`; the rest of the flow is unchanged. On APPROVE the buyer sees a partial refund in Link; on REJECT a full one.

Spend controls to show on stage: the marketplace cap (`whoami` → `spend.cap_cents / reserved / spent / available`), Link's per-transaction and daily limits (`user-info retrieve`), and the approval on the phone. Record a screen capture; if Link onboarding or verification blocks, demo the simulated path above instead and keep card mode as the default.

## Card mode commands

```sh
pnpm dev:server --no-open
node scripts/buyer.mjs post "What is the capital of France? Answer in one word." --expect Paris --max 100
pnpm daemon --role seller --runtime node --once
pnpm daemon --role judge  --runtime node --once
node scripts/buyer.mjs task <task_id>        # settlement.stripe_transfer_id is set
```

## GA vs preview

| | status |
|---|---|
| PaymentIntents manual capture, Customers, Refunds, Transfers | GA |
| Accounts v2 (`/v2/core/accounts`, account links v2) | GA (Stripe SDK v23, API `2026-…`) |
| Shared Payment Tokens, `test_helpers/shared_payment/granted_tokens`, Machine Payments Protocol, mppx `stripe/charge` | **preview** — needs machine payments enabled on the Stripe account; the test helper works in test mode without the Link app |
| Link CLI / Link agent wallet | preview; requires a US Link account on a phone |

## Failure recovery — what the provider guarantees (P1/P2)

The service (A) orchestrates; the provider layer promises these, each covered by `src/payments.test.ts`:

| failure | provider behaviour | service hook |
|---|---|---|
| ambiguous hold response (timeout, lost reply) | `hold()` creates the PaymentIntent with the task-scoped key `atm:<task>:hold`; replaying `hold(task, buyer)` with the same task id and amount returns the **same** intent, never a second authorisation. A failed hold carries `hold_outcome`: `not_created` only when Stripe definitively rejected it (decided 4xx), `unknown` for timeouts/transport/5xx/idempotency conflicts — `holdOutcomeOf(err)` reads it. | `postTask` recovery replays `hold()`; releases the reservation only on `not_created` |
| task insert fails after a successful hold | `compensateHold(task, hold, reason)` cancels the card hold with the same idempotency key as `release()`, verifies on Stripe when the cancel errors, and throws a retryable `PAYMENT_FAILED` only if the undo is unconfirmed. MPP tasks hold no money before payment. | `postTask`: on insert error → `await payments().compensateHold(…)` + un-reserve |
| crash between `transfers.create` and recording its id | `reconcileSellerTransfer` looks up Stripe transfers by `transfer_group = task_id` **before** creating and adopts one only if destination, amount, currency and group all match (`recovered: true`); anything that exists but does not match is `PENDING` / `MISMATCH` for an operator, never claimed as paid, and no second transfer is created | re-run `submit_verdict` / retry sweep |
| transfer fails after capture (onboarding, provider error) | `capture()` returns `transfer_state = PENDING` with `pending_reason ∈ {PENDING_ONBOARDING, PROVIDER_ERROR}`, `owed_cents = price` (→ `payout_owed_cents`), `transferred_cents = 0` (→ `payout_transferred_cents`), `stripe_transfer_id = null`; the task still settles | A persists `transfer_state`/`transfer_attempts` and schedules `retryTransfer` |
| retrying that transfer | `retryTransfer(task, seller, amountCents, { attempt: transfer_attempts, known_transfer_id })` verifies a recorded id field by field, else adopts a matching existing transfer, else creates one with `atm:<task>:transfer:r<attempt>`. Every outcome carries `retry_safe_to_advance`: **true only when Stripe definitively rejected the create** (its error is now stored under that key, so the next attempt needs the next key); false for transport/timeouts/5xx/429, lookup uncertainty, onboarding blocks and MISMATCH (reuse the key, or stop). `transferred_cents` is the amount the transfer actually moved. At most one transfer per task from one process; **concurrent** sweeps need A's per-settlement lease/CAS before calling (the lookup cannot see an in-flight create) | `sweep()` or an operator tool; B shows *owed* vs *transferred* |
| asserting the money | `inspect(task)` → `{authorized, captured, refunded, transferred, transfer_ids}` from Stripe (or the mock ledger) | fault tests assert no orphaned hold, ≤1 capture, exactly 1 transfer |
| offline fault injection | `PAYMENT_MODE=mock` + `MOCK_PAYMENT_FAULTS="hold:1,capture,transfer:2,release,compensate"` — bare step fails always, `step:N` fails the first N calls; `step~:N` makes them **transient** (`hold_outcome: unknown`, `retry_safe_to_advance: false`), otherwise mock faults are definitive | `DB_MODE=memory` tests in A's suite |
| paying an MPP task that belongs to a job | `markTaskPaid` reserves the offer on the buyer cap **and** the job budget with key `paid:<task>` (replays are no-ops); a refusal or a failed open compensates with key `unpaid:<task>` and the route refunds the charge | A's `adjustBuyerBalance` / `adjustJobBudget` |

## Never real money — where the hard stops are

| layer | guarantee |
|---|---|
| server start | `createStripe()` throws unless `STRIPE_SECRET_KEY` starts with `sk_test_`; both rails share it |
| MPP methods | only `stripe/charge` with `paymentMethodTypes: ["card","link"]` is offered; no stablecoin or crypto rails are configured |
| every MPP payment | `assertTestMoney()` re-reads the PaymentIntent: `livemode` must be false and the amount ≤ the task's max, else the payment is refunded and the task stays unpaid |
| Stripe itself | a live-mode token cannot be charged with a test key; the SPT test helper only exists in test mode |
| CLI side | every documented `link-cli` command carries `--test`; `pay-task.mjs` and `simulate-spt.mjs` refuse non-test keys and live tokens |
| seller side | connected accounts never get an `external_account`, so nothing can be paid out to a bank |

## Removing the human from the loop (test money)

Two gates apply: the marketplace enforces its server-side spending cap, and the Link wallet can require the human to approve a spend request. Approval-policy availability depends on the Link account.

For an agent that must pay **autonomously with test money today**, use the test-helper token instead of a wallet:

```sh
node docs/payments/pay-task.mjs <payment_link>     # probes the 402, mints a test SPT, pays, prints the receipt
```

It is the same protocol and the same server path as the Link wallet (`pi_…` with `machine_payment=true`, refund + transfer at settlement); the only difference is who mints the token. Give a buyer agent that one command (or wire it into `scripts/buyer.mjs`) and the whole buy → run → judge → settle loop runs with no human.

## Where the money is, honestly

Card mode moves test money from a Stripe test card into the platform's test balance and on to a test connected account. MPP mode moves it from a test Shared Payment Token. Nothing here is real money, nothing is a payout to a bank account (`external_account` is never attached), and the seller identity is synthetic. The human-control story is real: the cap is enforced server-side on every `post_task`, and in MPP mode no charge happens until a person approves the wallet's spend request.
