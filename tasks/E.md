# Computer E: judge, reputation, mock payments, and demo

You own `apps/judge/`, `apps/payments/`, `tests/e2e/`, and `demo/`. Work on `work/E-judge`. Read the root `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md` before coding. Ask A about contract changes in `coordination/messages/E-to-A.md`.

## Build

1. Build a judge worker that receives a task only when the buyer has opted in and supplied the judge envelope. Verify the result commitment before judging, then evaluate a synthetic task against a buyer-provided rubric or tests. Store the verdict, reason, and evidence reference. Make the demo review rate 100% so both accepted and rejected outcomes are repeatable; keep random sampling as a configurable later step.
2. Define the failure path. A rejected seller result does not earn a mock payout. Return an actual judge-produced replacement answer only if your worker ran the replacement; otherwise show a failed terminal job and let the buyer create a new one. Record a low-quality result separately from a confirmed malicious act. Apply a visible, reversible seller suspension only to the latter.
3. Build a mock payment ledger that reserves the maximum price at task creation, credits the seller's locked claim price and refunds the difference after approval, and refunds the full reserve after rejection or final expiry. Keep settlement idempotent. Label every balance and payment screen as simulated. Add x402 or on-chain settlement only after the full mock flow works and real transaction evidence can be shown.
4. Write an end-to-end demo script and a short operator guide. Use non-sensitive prompts. Include an accepted case, a rejected case, a seller timeout, and the visible state and mock balance after each.

## Verify and hand off

Run the demo with A's API, B's buyer, C's seller, and D's handoff. Check that private content reaches the judge only with consent, duplicate verdicts do not pay twice, and a rejection records its reason. Send A the branch, commit, demo command, outcomes, and blockers in `E-to-A.md`. Ask every owner to acknowledge their integration handoff before the final demo.
