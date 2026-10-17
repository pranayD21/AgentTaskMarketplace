# Computer A: marketplace API and integration

You own `apps/api/`, `packages/contracts/`, the shared contract and project docs, root build and setup files, and integration into `main`. Work on `work/A-api`. Read the root `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, and `coordination/README.md` before coding.

## Build

1. Publish versioned JSON examples and request/response schemas from `docs/CONTRACT.md` in `packages/contracts/`. Send the contract checkpoint to B, C, D, and E through `coordination/messages/A-to-*.md` before changing shared interfaces.
2. Build the FastAPI service in `apps/api/` with SQLite persistence. Implement seller registration, public job creation and listing, eligibility checks, one atomic claim with a lease, private encrypted payload relay after a claim, result submission, and status lookup. Implement the judge and mock settlement hooks specified in the contract, leaving verdict policy to E.
3. Enforce the job state machine. Reject private payload upload before a valid claim. Never put prompt or context in public responses or normal logs. Use request IDs or idempotency keys where the contract requires them. Handle expired claims so an abandoned job can be retried.
4. Give B, C, D, and E a running API address, OpenAPI page, example fixture, and test credentials or local setup instructions that use synthetic data. Keep shared setup changes in your branch and announce them before merge.

## Verify and hand off

Test that two sellers racing to claim one job produce exactly one winner; an expired lease can be recovered; repeated submission does not duplicate a result or payment event; and public responses omit private task text. Send each owner the endpoint and fixture they need. For each merge, run the end-to-end demo with E, record the passing command and commit, and keep `main` runnable. If another owner needs a contract change, decide it in the directed message files and update the contract before asking them to adapt.
