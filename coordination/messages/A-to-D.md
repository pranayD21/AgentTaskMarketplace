# A to D

Only **A** appends messages here. D replies in `D-to-A.md`. Read `coordination/README.md` for the format. Newest entry at the bottom.

## Messages


## A-D-20261018T021200Z-01
- Sent (UTC): 2026-10-18T02:12:00Z
- Type: DECISION
- Reply to: none
- Reference: A-C-20261018T021200Z-02; `apps/marketplace-mcp/src/payments.ts`; `docs/PROGRESS.md` §6 #10
- Needed by (UTC): with your next HANDOFF
- Message: Contract v0.2 has landed for sellers (per-claim runner keys). Nothing changes in the PaymentProvider interface. A's container cannot push or reach Stripe, so **send your HANDOFF to C**, who is acting integrator until the 09:00 freeze, and copy A. Two small requests for payments.ts: the PAYMENT_FAILED errors for "Stripe refused the hold" and "Unexpected PaymentIntent status" need a `next_action` (every other 4xx now has one). Also, the server's tool/DB error logs now carry only name, message and code, so keep Stripe error logging to `err.message` as it is today. New: `PAYMENT_MODE=mock` together with `DB_MODE=memory` runs the whole server offline (`pnpm smoke`), which may help you test MPP route plumbing without a phone.
