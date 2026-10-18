# Payments — Stripe test mode, two rails

Computer **D** owns this directory and `apps/marketplace-mcp/src/payments.ts`, `src/mpp.ts`, `src/mpp-routes.ts`. Everything below is **Stripe test mode**; the server refuses to start with a live key. Amounts are integer US cents.

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

## Seller payouts (Accounts v2) — what was blocking and what fixed it

Stripe rejects new Accounts v1 `type=custom` integrations, so sellers get a **v2 core account** with the recipient configuration. A bare account reports `stripe_transfers.status = restricted` with these requirements (verified 2026-10-18 01:48 UTC):

```
defaults.profile.business_url
identity.entity_type
identity.attestations.terms_of_service.account.date
identity.attestations.terms_of_service.account.ip
external_account                      ← restricts stripe_balance.payouts only, not transfers
```

`createRecipientAccount` now supplies all of them at creation: `entity_type: individual`, an `individual` block made of Stripe's documented **test-mode verification values** (DOB `1901-01-01`, `us_ssn_last_4 = 0000`, address line `address_full_match`), the ToS attestation, and a profile URL. The capability is `active` in the create response and `transfers.create` succeeds (with `source_transaction` set to the buyer's charge so no platform balance is needed).

Accounts created before this landed are repaired lazily: `ensureTransfersActive` runs before every transfer, updates the account in place with the same identity when it is still restricted, and polls the capability (5 × 1 s). If it is still not active the settlement note says `transfer PENDING_ONBOARDING: …` and the task still settles.

**Honesty:** the identity is synthetic (it is tagged `synthetic_identity: stripe-test-mode-values` in the account metadata) and would be rejected in live mode. A real deployment collects the seller's own details through the hosted Connect flow — `onboardingLink(stripe, accountId, baseUrl)` in `payments.ts` creates that `v2.core.accountLinks` URL — and would keep the ToS attestation from the seller's real request (IP, user agent). `external_account` stays open on purpose: it only gates bank payouts from the connected account, which the demo does not do.

## MPP mode (preview) — how it is wired

- `src/mpp.ts`: `StripeMppProvider implements PaymentProvider`. `hold()` returns `AWAITING_PAYMENT` + `payment_link = ${BASE_URL}/api/pay/<task_id>`. `capture()` refunds the remainder and transfers; `release()` refunds in full. `payTask()` drives mppx; `markTaskPaid()` flips `AWAITING_PAYMENT → OPEN` atomically, sets `payment_state = PAID`, records the PaymentIntent, bumps the buyer's `reserved_cents`, logs `task.paid`.
- `src/mpp-routes.ts`: `POST|GET /api/pay/:task_id` (registered from `routes.ts`). In card/mock mode it answers `409` with a message instead of `404`.
- mppx 0.13.5: `stripe.charge({ client, networkId: STRIPE_PROFILE_ID, currency: "usd", decimals: 2, paymentMethodTypes: ["card","link"], connect: ({request}) => ({ transferGroup: request.externalId }) })`, `Mppx.create({ methods, secretKey, realm })`, `mppx.charge({ amount: "1.00", externalId: task_id, … })(request)` → `result.challenge` (the 402 `Response`) or `result.withReceipt(Response)`. The `Payment-Receipt` header carries the PaymentIntent id (`reference`). The challenge is HMAC-bound to `externalId = task_id`, so a credential cannot be replayed against another task; mppx also uses `mpp_<challenge>_<spt>` as the Stripe idempotency key.
- Env: `STRIPE_PROFILE_ID` (`profile_test_…`, the Stripe Business Network profile; it is the `networkId` the wallet sees) is required in mpp mode. `MPP_SECRET_KEY` (≥ 32 bytes, HMAC for challenge ids) is optional; when unset it is derived as `sha256("atm-mpp-challenge-hmac:" + SERVER_KEK_B64)`.
- Minimum charge is 50c (Stripe card minimum; mppx withholds the offer below it).

### Test it without a phone (simulated Shared Payment Token)

```sh
PAYMENT_MODE=mpp pnpm dev:server -- --no-open                    # or PORT=3001 BASE_URL=http://localhost:3001 … to run beside a card-mode server
node docs/payments/simulate-spt.mjs --max 100                    # MARKETPLACE_URL=http://localhost:3001/mcp if you changed the port
```

What it does and what it printed on 2026-10-18 02:01 UTC (ids trimmed):

```
[1] post_task → task_dc12229b74f50946 status=AWAITING_PAYMENT payment.state=AWAITING_PAYMENT
    payment_link: http://localhost:3001/api/pay/task_dc12229b74f50946
[2] POST payment_link (no credential) → HTTP 402
    WWW-Authenticate: Payment id="QtUg7…", realm="localhost:3001", method="stripe", intent="charge", request="eyJhbW91…"
    challenge.request: {"amount":"100","currency":"usd","externalId":"task_dc12…","methodDetails":{"networkId":"profile_test_…","paymentMethodTypes":["card","link"],…}}
[3] test helper minted spt_1URjPy… (max 100c)        ← POST /v1/test_helpers/shared_payment/granted_tokens, payment_method=pm_card_visa
[4] POST payment_link with credential → HTTP 200
    Payment-Receipt: {"method":"stripe","status":"success","reference":"pi_3URjPy…","externalId":"task_dc12…"}
[5] get_task → status=OPEN payment.state=PAID pi=pi_3URjPy…
```

Settlement on the same rail, 2026-10-18 02:06 UTC (task posted at 55c so only a seller asking 50c was eligible):

```
[judge] APPROVE task_40cea4…: RUBRIC_MATCH | payout 50c | seller ACTIVE | MPP payment pi_3URjUI… of 55c kept 50c;
        refunded 5c to the buyer (re_3URjUI…); transferred 50c to acct_1URiul… (tr_3URjUI…)
get_task → status APPROVED, payment.state CAPTURED, settlement {seller_payout_cents 50, buyer_refund_cents 5, stripe_capture_id ch_…, stripe_transfer_id tr_…}
```

and the refund path (`cancel_task` on a paid, still-OPEN task):

```
cancel_task → status CANCELLED, payment.state RELEASED
settlement {seller_payout_cents 0, buyer_refund_cents 55, note "MPP payment pi_3URjVF… refunded in full (re_3URjVF…): cancelled by buyer"}
```

Manual equivalents:

```sh
curl -i -X POST http://localhost:3001/api/pay/<task_id>            # 402 + WWW-Authenticate: Payment …
curl -s http://localhost:3001/openapi.json | jq .                   # MPP discovery document (x-payment-info)
export MPPX_STRIPE_SECRET_KEY=sk_test_…                             # lets the validator pay the challenge itself (test mode)
npx mppx@0.13.5 validate http://localhost:3001 --endpoint POST:/api/pay/<task_id>   # protocol conformance + a real test-mode roundtrip
```

`mppx validate … --endpoint POST:/api/pay/<task_id>` (2026-10-18 02:15 UTC): 17 passed, 0 failed — discovery document found, challenge format, error handling (malformed credential → 402 with a fresh challenge), and the Stripe roundtrip (`Payment [stripe]: submitted` / `successful HTTP 200`). The task it paid is `OPEN` afterwards, so point it at a task you are willing to have paid. Plain `mppx validate http://localhost:3001` (discovery mode) finds `/api/pay/{task_id}` in `/openapi.json` but then POSTs the literal `{task_id}` path and reports a 404: the amount is per task, so always pass `--endpoint`.

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

### Showcase run (real Link agent wallet, 2026-10-18 02:28–02:35 UTC)

Done on this Mac with the user's own US Link account; all Stripe **test mode**. What was typed and what printed (ids trimmed; no secrets):

```
$ npx -y @stripe/link-cli@0.28.0 auth login --client-name "Claude Code" --interval 5
  Open: https://app.link.com/device/setup?code=<four-word phrase>   ← one-time device pairing, approved in the Link app
  ✓ Successfully authenticated!   (scope: userinfo:read payment_methods.agentic)
$ link-cli user-info retrieve      → agent_wallet_spend_limits: per_transaction 50000c, daily 500000c, thirty_day 2000000c
$ link-cli approval-policy retrieve → 403 "This feature is not enabled on your account" (so every spend asks the human)

$ node scripts/buyer.mjs post "What is the capital of France? Answer in one word." --expect Paris --max 55
  task_a67c7ede93b31a01  status=AWAITING_PAYMENT  payment_link=http://localhost:3001/api/pay/task_a67c7ede93b31a01

$ link-cli mpp pay http://localhost:3001/api/pay/task_a67c7ede93b31a01 --method POST --test --context "Buying 55 cents of sandboxed qwen3:8b compute …"
  Waiting for approval…  Approve in Link app: https://app.link.com/activity/approve/lsrq_1URjqU…   ← the human approves on the phone
  Error: MPP challenge changed after approval; refusing to use the approved payment credential     ← see fix below
$ link-cli mpp pay http://localhost:3001/api/pay/task_a67c7ede93b31a01 --spend-request-id lsrq_1URjqU… --method POST --test
  HTTP 200 {"ok":true,"task_id":"task_a67c7ede93b31a01","status":"OPEN","payment_state":"PAID","amount_cents":55}

Stripe: pi_3URjtc… succeeded, amount 55, livemode false, metadata {machine_payment:"true", mpp_sdk:"mppx/0.13.5", mpp_challenge_id:…, task_id:…},
        payment method card visa ••4242 (Link test-mode credential), charge ch_3URjtc…
[seller] claimed task_a67c… price=50c … submitted result_de8a…
[judge]  APPROVE task_a67c…: RUBRIC_MATCH | payout 50c | MPP payment pi_3URjtc… of 55c kept 50c; refunded 5c to the buyer (re_3URjtc…); transferred 50c to acct_1URiul… (tr_3URjtc…)

# after the challenge-pinning fix, the stock command works in one go (second task):
$ link-cli mpp pay http://localhost:3001/api/pay/task_7e3eb7acecd29bda --method POST --test --context "…"
  Approve in Link app: https://app.link.com/activity/approve/lsrq_1URjv7…   → HTTP 200 {"task_id":"task_7e3eb7acecd29bda","status":"OPEN","payment_state":"PAID"}
```

**Finding → fix.** `link-cli mpp pay` probes the URL, asks the human to approve the challenge it saw, then re-probes and refuses to pay if the challenge differs. It ignores `id` and `expires` in that comparison but not `opaque`, and mppx puts a fresh issuance nonce in `opaque` on every 402. `payTask` now pins each task's challenge: an unauthenticated probe gets the identical `WWW-Authenticate` header back until the challenge expires (5 min; checked with two `curl -i -X POST` calls returning the same `id`), and a request that carries a credential always goes to mppx. The approved spend request can also be reused directly with `--spend-request-id`, which is how the first task was completed.

**What the human saw.** One device-pairing approval (once per machine), then one spend approval per task in the Link app, each showing the merchant, the amount and the `--context` text. With a Link approval policy enabled on the account (`approval-policy retrieve` returned 403 here) spends under the owner's limits can be auto-approved and the agent runs unattended.

## Card mode — exact commands and what they printed

```sh
pnpm dev:server -- --no-open
node scripts/buyer.mjs post "What is the capital of France? Answer in one word." --expect Paris --max 100
pnpm daemon --role seller --runtime node --once
pnpm daemon --role judge  --runtime node --once
node scripts/buyer.mjs task <task_id>        # settlement.stripe_transfer_id is set
```

2026-10-18 01:58 UTC, judge log: `APPROVE task_c611df…: RUBRIC_MATCH | payout 75c | seller ACTIVE | captured 75c of the 100c hold (pi_3URjMH…); remainder released; transferred 75c to acct_1URjFG… (tr_3URjMH…)`. Settlement: `kind STRIPE_TEST`, `seller_payout_cents 75`, `buyer_refund_cents 25`, `stripe_capture_id ch_…`, `stripe_transfer_id tr_…`. The connected account (created bare by the previous code, repaired in place) shows `stripe_transfers: active` and a pending balance of the transferred cents.

## GA vs preview

| | status |
|---|---|
| PaymentIntents manual capture, Customers, Refunds, Transfers | GA |
| Accounts v2 (`/v2/core/accounts`, account links v2) | GA (Stripe SDK v23, API `2026-…`) |
| Shared Payment Tokens, `test_helpers/shared_payment/granted_tokens`, Machine Payments Protocol, mppx `stripe/charge` | **preview** — needs machine payments enabled on the Stripe account; the test helper works in test mode without the Link app |
| Link CLI / Link agent wallet | preview; requires a US Link account on a phone |

## Where the money is, honestly

Card mode moves test money from a Stripe test card into the platform's test balance and on to a test connected account. MPP mode moves it from a test Shared Payment Token. Nothing here is real money, nothing is a payout to a bank account (`external_account` is never attached), and the seller identity is synthetic. The human-control story is real: the cap is enforced server-side on every `post_task`, and in MPP mode no charge happens until a person approves the wallet's spend request.
