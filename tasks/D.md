# Computer D — payments: seller payouts and the Stripe agent-wallet showcase

## Second computer is available: resume L1/F1 now

The human confirmed on October 17 that D is available and should join the network to complete the deferred two-computer job demonstration. Read the newest C-to-D message, acknowledge READY in D-to-C, run the local canary, and retain seller `seller_0213ff3d1ffc3278` with its existing private state. Your approved standalone task proves connectivity. The remaining check requires you and C to execute different parts of one parent job at overlapping times, then verify results and payments. A supplies the parent-job/task-pricing server, B the buyer job and child IDs, C integration and first seller, E judge and evidence. Do not create a substitute task while waiting for the real child ID.

## Latest product change: price tasks (2026-10-17, 20:25 PDT)

The human has changed the product requirement: tasks carry a posted price; sellers do not set per-task compute prices. A seller accepts the task price by claiming it. Keep the accepted price fixed through settlement. Existing claimed tasks keep their agreed price. Future task prices should respond to market demand and completion evidence; do not claim market equilibrium before measuring it or raise buyer spending caps automatically.

Own payment tests and cost documentation for fixed task offers. Verify legacy seller asks cannot change payout, cancellation/refund paths are correct, and accepted prices survive transfer retries. Coordinate API/settlement changes through A. Separate task payout from judge/provider/hosting costs.

Read the newest C-to-D.md message for the handoff. This section takes priority over historical seller ask-price instructions below.

## Completion audit: your next assignment (2026-10-17, 20:05 PDT)

The core marketplace is running, but the full original request is unfinished. This section takes priority over the historical build checklist below. The [completion audit](../docs/COMPLETION-AUDIT.md) gives evidence, assignment IDs and acceptance criteria. Fresh checks on `82d0aa2` passed workspace typecheck, 79 tests and smoke. Earlier real-Wassette and hosted purchase evidence remains valid. No cost benchmark or complete multi-computer job demonstration has been recorded.

Start by fetching the latest `origin/main` and bringing it into your existing feature branch without discarding local work. Read your four inbound files in `coordination/messages/`, then acknowledge this assignment to C in `<YOUR LETTER>-to-C.md` (C records its own progress in its outbound handoffs). C remains acting integrator under A's delegation. Send contract/schema requests to A; C coordinates merges. Do not edit another computer's implementation files without a recorded ownership decision.

Use `MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp` in your private environment. Application health is `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`; dashboard is `http://192.168.4.163:5173/` on C's LAN. Workers use `--poll-ms 5000`. Preserve the running service and existing identities. Do not reset shared Inkbox identities. The Armature buyer has 25 cents available, below the 50-cent new-task minimum; a new buyer or higher cap must not be used to bypass that limit. All current payment evidence is Stripe TEST mode.

### Your work, in order

1. **P1, with A:** provide payment-provider compensation and money assertions for task-insert failure after a successful hold and crashes during settlement finalization. A owns service/database orchestration. Acceptance: isolated fault injection at each step produces no orphaned hold, duplicate capture/refund or stranded reserved balance when retried.
2. **P2, lead:** implement idempotent retry/reconciliation for a captured payment whose seller transfer failed. Ask A for persistent retry status; tell B how to distinguish amount owed from amount transferred. Acceptance: a provider failure followed by recovery yields exactly one transfer and records its ID. Preserve the explicit pending fallback.
3. **F1, budget support:** review A/B's parent-job budget and per-part accounting, including failed parts and retries. Sum reservations and spend across the job. Recovery must not create another purchase for an accepted part.
4. **B1, cost lead:** define and reconcile buyer cost separately from system resource cost. Include controller/baseline tokens, seller energy and stated hardware amortization, hosting, judge/replacement calls, retries and relevant payment fees. Publish total cost per successful task with the workload quality threshold, assumptions and current official rate sources. Do not count a marketplace transfer twice or treat the 75-cent test price as measured inference cost. Coordinate usage fields with A/B/C/E.
5. **L1, second physical seller:** with C's setup help, run local Ollama and a Wassette seller on D's machine using an authorized seller identity and the hosted endpoint. Use `--poll-ms 5000`; seller operation needs no judge private key. Complete a different child task from C and record timestamps/IDs. If this machine cannot run the model, tell C immediately so a capable A/E machine can take the role.
6. **D1/X1:** keep the verified human-approved MPP/Link evidence available for E's rehearsal. Real seller onboarding, live-money operation and operator-approved enrollment are later production work with A; current evidence is Stripe TEST mode.

### Finish and hand off

Own `payments.ts`, `mpp*.ts` and `docs/payments/**` on your existing D feature branch. A owns service/schema tests and changes outside those paths unless explicitly delegated. Send C assignment IDs, branch/SHA, exact verification results, transaction IDs without credentials, and any unpaid/pending amounts. Existing successful transfer evidence does not close failed-transfer recovery.

## Historical handoff (2026-10-17, 19:58 PDT)

The payment integration and Link wallet follow-up at 0cb3ff2 are merged (5f2b6b3). Atomic caps, truthful refund errors and PAID expiry handling are preserved. Stripe TEST card transfers and MPP flows have live evidence. Keep the recorded human-approved Link flow available for rehearsal.

Shared MCP endpoint: `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`. Application health: `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`. Public dashboard on C’s LAN: `http://192.168.4.163:5173`. Set `MARKETPLACE_URL` to the hosted endpoint in your private environment. Local agents need `--poll-ms 5000`. All payments are Stripe TEST mode.

Latest completed checks: 79 tests, workspace typecheck and smoke passed; the real-Wassette daemon suite passed 7/7. Three Armature cases passed 5/5 each: accepted purchase, cap rejection and simulated task-ID recovery. Pending-seller and rejected-result cases lack fixtures within the remaining 25-cent cap; see the report for the exact limits. Read your four incoming coordination files before starting; the original implementation checklist below records the build assignment and may describe work that is already complete. Deployment details are in `docs/DEPLOYMENT.md`; evidence is in `docs/PROGRESS.md` and `docs/ARMATURE-RESULTS.md`.

You are **D**. You own `apps/marketplace-mcp/src/payments.ts`, a new `apps/marketplace-mcp/src/mpp.ts` (and `mpp-routes.ts` if you want), and `docs/payments/**`. The card-mode hold → capture → release flow already works (see `docs/PROGRESS.md` §4). Your job is (1) real seller payouts and (2) the Stripe-track showcase where the buyer **agent** pays through Stripe's Machine Payments Protocol with a human approving the spend.

## 0. Setup (10 min)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
git switch -c feat/d-payments origin/main
pnpm install && pnpm -r typecheck
# .env from the human: STRIPE_SECRET_KEY (sk_test_…), STRIPE_PROFILE_ID (profile_test_…), plus INSFORGE_* and the KEK/judge values so you can run your own server.
pnpm dev:server --no-open
node scripts/buyer.mjs post "Say hello." --expect hello --max 100     # creates a hold; see it at https://dashboard.stripe.com/test/payments
```

Read `docs/PROGRESS.md` §3 (payments.ts) and §5 (Stripe findings), `docs/CONTRACT.md` §5, `docs/PLAN.md` §4, `docs/SECURITY.md` → Payments.

## 1. Seller payouts (Accounts v2) — target 23:00

`StripeCardProvider.onboardSeller` creates a v2 recipient account (`stripe.v2.core.accounts.create`) but `transfers.create` fails: the `stripe_transfers` capability is not active until requirements are met. Make transfers succeed in the sandbox:
- Inspect `account.requirements` / `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status` on the created account; supply what test mode needs (identity `business_details`/`individual` fields, `tos_acceptance`, test identity tokens — Stripe docs: Accounts v2, "recipient configuration"). Prefer API-only onboarding; if a hosted onboarding link is unavoidable, generate it and document the one-time human step.
- Poll the capability until active (bounded) at `register_seller` time, or lazily at first capture; keep `PENDING_ONBOARDING` as the labelled fallback.
- Confirm end to end: approve a task → `transfers.create` succeeds → `settlements.stripe_transfer_id` set → visible under the connected account in the dashboard.

Only `payments.ts` changes; if you need a schema column (e.g. `stripe_account_status`), ask A.

## 2. MPP mode (`PAYMENT_MODE=mpp`) — target 02:00, time-boxed

Design in `docs/PLAN.md` §4. Build it as a second provider plus one Hono route, without touching other server files more than necessary (A merges; keep edits surgical and listed in your handoff):

1. `src/mpp.ts`: `StripeMppProvider implements PaymentProvider`. `hold()` returns `{ payment_state: "AWAITING_PAYMENT", payment_link: \`${baseUrl}/api/pay/${task.id}\`, task_status: "AWAITING_PAYMENT" }`. `capture()` → `refunds.create` for `max − price` on the stored PaymentIntent + transfer; `release()` → full refund.
2. Route `POST|GET /api/pay/:task_id` (register it from `registerRoutes` — one-line change in `routes.ts`, tell A): `mppx` server (`npm i mppx`), `Mppx.create({ methods: [stripe.create({ client, networkId: STRIPE_PROFILE_ID, livemode: false }).spt.charge()], secretKey })`; `mppx.compose(["stripe/charge", { amount: (max_price_cents/100).toFixed(2), currency: "usd", decimals: 2, description }])(request)`; on 402 return `result.challenge`; on success record the PaymentIntent id, set the task `OPEN` / `payment_state: HELD`-equivalent (`PAID`), and return `result.withReceipt(Response.json({ ok, task_id }))`. You need a tiny service hook for "mark paid"; ask A for `markTaskPaid(taskId, paymentIntentId)` in `service.ts` or propose the 10-line addition in your message.
3. Test without a phone: `curl -i -X POST localhost:3000/api/pay/<task_id>` → 402 with `WWW-Authenticate: Payment …`; `npx mppx@latest validate http://localhost:3000` (sandbox roundtrip); `POST /v1/test_helpers/shared_payment/granted_tokens` with `pm_card_visa` to simulate a granted SPT.
4. Buyer side (the showcase): `npm i -g @stripe/link-cli`, `link-cli auth login --client-name "Claude Code"` (US Link account on the human's phone), then in Claude Code add `{"mcpServers":{"link":{"command":"npx","args":["@stripe/link-cli","--mcp"]}}}` and have the agent: `post_task` → receive `payment_link` → `spend-request create --credential-type shared_payment_token --network-id profile_test_… --test --request-approval` → human approves on phone → `mpp pay <payment_link>`. Record a screen capture for the demo.
5. Spend controls to show: `link-cli user-info retrieve` (per-transaction/daily limits), `approval-policy retrieve`, plus our `spend_cap_cents`.

If Link onboarding/verification blocks, stop at step 3 (server-side 402 + simulated SPT) and demo that; card mode remains the default.

## 3. Payments docs + demo notes — target 03:00

`docs/payments/README.md`: the two modes, the Stripe objects created at each step (customer, PaymentIntent hold, capture, refund, v2 account, transfer), dashboard URLs to open during the demo, exact test commands, what is GA vs preview, and the human-control story (cap + per-spend approval). Send E the demo steps (`D-to-E`).

## Verify and hand off

- Card mode: approve → transfer id present; reject → hold cancelled. Both visible in the Stripe test dashboard.
- MPP: 402 challenge reproducible; at least the simulated SPT path completes and flips the task to `OPEN`.
- `HANDOFF` to A: branch, commit, files touched (list each; A merges), env vars added to `.env.example` (ask A to add), commands and outputs, what is preview-only.
