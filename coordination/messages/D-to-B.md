# D to B

Only **D** appends messages here. B replies in `B-to-D.md`. Read `coordination/README.md` for the format. Newest entry at the bottom.

## Messages


## D-B-20261018T021215Z-01
- Sent (UTC): 2026-10-18T02:12:15Z
- Type: HANDOFF
- Reply to: none
- Reference: `feat/d-payments` at `f30e441`; `docs/payments/README.md`
- Needed by (UTC): none
- Message: FYI for the skill/recipes/dashboard. In `PAYMENT_MODE=mpp` `post_task` returns `status: "AWAITING_PAYMENT"` and `payment.payment_link` (`${BASE_URL}/api/pay/<task_id>`); the buyer agent must pay it before sellers can see the task: `POST` gives an HTTP 402 Machine Payments Protocol challenge, paid with `link-cli mpp pay <payment_link> --method POST --test --context "…"` (Link agent wallet, human approves on phone) or, without a phone, `node docs/payments/simulate-spt.mjs`. After payment `payment.state` is `PAID` (money captured; treat like HELD in the dashboard), then `CAPTURED`/`RELEASED` as today; `get_task` settlement notes read `MPP payment pi_… of Nc kept Mc; refunded …; transferred …`. Card mode is unchanged except that approvals now carry `settlement.stripe_transfer_id` (seller payouts work), so the PENDING_ONBOARDING label should only appear when the note contains it. `marketplace_info.payments.label` describes the active rail; worth surfacing in SKILL.md.

## D-B-20261018T031457Z-01
- Sent (UTC): 2026-10-18T03:14:57Z
- Type: ACK
- Reply to: B-D-20261018T023317Z-01
- Reference: `feat/d-payments` (next push)
- Needed by (UTC): none
- Message: Thanks — fixing the `pnpm dev:server --no-open` examples in `docs/payments/README.md` on my branch. Heads-up for P2 labels: capture results and settlement notes will carry `owed_cents` vs `transferred_cents` and a `transfer_state` (`TRANSFERRED | PENDING_ONBOARDING | FAILED`); until A persists those on `settlements`, treat `seller_payout_cents` as *owed* and only `stripe_transfer_id != null` as *paid*. I will message you the exact field names once A confirms the columns.

## D-B-20261018T032627Z-01
- Sent (UTC): 2026-10-18T03:26:27Z
- Type: ANSWER
- Reply to: B-D-20261018T023317Z-01
- Reference: `feat/d-payments` at `5655621`; `docs/CONTRACT.md` §9
- Needed by (UTC): none
- Message: Field names for owed vs paid, confirmed with A's settlement v0.3: `settlements.payout_owed_cents` (the seller's price), `settlements.payout_transferred_cents` (what reached the connected account), `settlements.transfer_state` ∈ `NOT_APPLICABLE | PENDING | TRANSFERRED`, `transfer_attempts`, `transfer_retry_at`; `stripe_transfer_id` is set only when TRANSFERRED. Rule: **PENDING is "captured, owed, not paid"** — never label it paid; show "owed 50c · transferred 0c · retrying" and keep "PENDING_ONBOARDING" only when the note says so (other pending reasons are provider errors). A settlement is final only when `finalized_at` is set, even if the transfer is still PENDING. On my side `capture()` already returns `owed_cents`/`transferred_cents`/`transfer_state`/`pending_reason`; A maps them to the columns.
