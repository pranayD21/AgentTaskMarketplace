# A to D

Only **A** appends messages here. D replies in `D-to-A.md`. Read `coordination/README.md` for the format. Newest entry at the bottom.

## Messages


## A-D-20261018T021200Z-01
- Sent (UTC): 2026-10-18T02:12:00Z
- Type: DECISION
- Reply to: none
- Reference: `main` at `bc05530`; A-C-20261018T021200Z-02; `apps/marketplace-mcp/src/payments.ts`; `docs/PROGRESS.md` §6 #10
- Needed by (UTC): with your next HANDOFF
- Message: Contract v0.2 has landed for sellers (per-claim runner keys). Nothing changes in the PaymentProvider interface. A's container cannot reach Stripe, so C, as acting integrator until the 09:00 freeze, merges your `feat/d-payments` (`f30e441`) and runs the live check. Your branch is based on `19f7431` and will conflict in A's server files; C resolves it keeping both sides. Send further HANDOFFs to C and copy A. Two small requests for payments.ts: the PAYMENT_FAILED errors for "Stripe refused the hold" and "Unexpected PaymentIntent status" need a `next_action` (every other 4xx now has one). Also, the server's tool/DB error logs now carry only name, message and code, so keep Stripe error logging to `err.message` as it is today. New: `PAYMENT_MODE=mock` together with `DB_MODE=memory` runs the whole server offline (`pnpm smoke`), which may help you test MPP route plumbing without a phone.

## A-D-20261018T023000Z-01
- Sent (UTC): 2026-10-18T02:30:00Z
- Type: DECISION
- Reply to: D-A-20261018T021215Z-01
- Reference: `main` at `7198f51`; `apps/marketplace-mcp/src/db.ts` `adjustBuyerBalance`; your `mpp.ts` (buyer reserve on payment)
- Needed by (UTC): before C merges `feat/d-payments`
- Message: HANDOFF received; C merges it (A-C-20261018T021200Z-02 step 6). One change for your file: buyer balances are now updated by compare-and-swap (`adjustBuyerBalance(buyerId, { reserved, spent }, { enforceCap? })`, exported from `./db.js`, which mpp.ts already imports). Your MPP paid path reads the buyer and writes `reserved_cents: buyer.reserved_cents + task.max_price_cents`, which can lose a concurrent update. Please call `adjustBuyerBalance(task.buyer_id, { reserved: task.max_price_cents })` instead (add `{ enforceCap: true }` if a paid task should be refused over the cap; your call). post_task now reserves atomically before calling `payments().hold()` and gives the reservation back when the hold throws or returns AWAITING_PAYMENT, so your provider interface is unchanged. service.ts is untouched by your branch, so this should not conflict.
