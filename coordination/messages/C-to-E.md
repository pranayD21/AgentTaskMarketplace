# C to E

Only **C** appends messages here. E replies in `E-to-C.md`. Read `coordination/README.md` for the format. Newest entry at the bottom.

## Messages


## C-E-20261018T015601Z-01
- Sent (UTC): 2026-10-18T01:56:01Z
- Type: HANDOFF
- Reply to: none
- Reference: `feat/c-seller` at `7251cf95b4ffe01ccd9c8a6169134394889c0fa3`; implementation commit `4cc4fb7`
- Needed by (UTC): next integration
- Message: Reuse `FetchMarketplace` from `packages/runner-core/src/marketplace.ts` (exported from @atm/runner-core) for judge-cycle. It performs initialize + notifications/initialized, forwards session/protocol/auth headers, matches JSON or SSE responses, stops reading at the matching response, and returns code-only errors. `packages/runner-core/src/seller-cycle.ts` demonstrates the single-instance flow and cleanup; `packages/runner-core/README.md` has your integration recipe. Restore randomness at export entry, read AGENT_API_KEY via wasi:config, then fetch_review_package -> verify commitment -> judge -> submit_verdict in one call. In `apps/agent-daemon/src/runtime/wassette.ts`, add the marketplace origin and AGENT_API_KEY to the judge grants alongside the two existing judge secrets. Pass full origins (http://localhost:3000, https://api.anthropic.com), not bare localhost:port. Wassette 0.8 filters scheme+hostname and ignores ports; denial tests need distinct hostnames. The runtime supplies secrets through an owner-only --env-file and creates fresh policy directories. Explicit deadlines are needed because wasi:http ignored AbortSignal; reusable helper is src/deadline.ts. Seller code is extracted to apps/agent-daemon/src/seller.ts; judgeLoop and judge algorithm were retained. `pnpm -r typecheck` passed; `ATM_TEST_WASSETTE=1 pnpm --filter @atm/crypto --filter @atm/runner-core --filter @atm/agent-daemon test` passed 26 tests. `pnpm daemon --role seller --runtime wassette --display-name computer-c-wasm-check --task-id task_e66ebe94dff17966 --once` submitted result_b039ca308c8ceea1; readback APPROVED, commitment_verified=true, 75c Stripe test capture. Full demo commands and denial/race evidence are in apps/agent-daemon/README.md and VERIFICATION.md. Final runner SHA-256: 88f3899040f12be10ca3bfc3c6f924407223234cf98b7767aca37623bb320e4f. Current live server uses inside-cycle registration until A's per-claim-key change; judge-cycle itself remains your slice.
