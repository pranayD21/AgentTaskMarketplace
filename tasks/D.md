# Computer D — payments: seller payouts and the Stripe agent-wallet showcase

## Current handoff (2026-10-17, 19:58 PDT)

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
