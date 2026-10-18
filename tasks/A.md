# Computer A — marketplace server, contract, integration, Manufact deployment

## Current A handoff, October 17, 21:05 PDT

The human assigned A and C to the same integrator. A's server, shared contract/schema, task pricing, durable posting, settlement recovery, jobs, usage schema, public-verdict privacy and Manufact deployment are complete and integrated. Hosted health verifies source `920c052`, contract 0.3 and task-offer pricing. Typecheck and 201 tests passed, including actual Wassette; real Insforge transactional posting and task-offer smoke passed. Keep the existing service and identities running.

Remaining shared gates: B's decomposition/aggregation and grouped UI; D joining the general worker pool for C/D overlap proof; E's final live fault/Inkbox/recording evidence; B/D's full cost comparison. X1 confidential inference remains later scope. Read [the current audit](../docs/COMPLETION-AUDIT.md) before the historical checklist. Do not rebuild the delivered slices or duplicate the deployment.


## Latest product change: price tasks (2026-10-17, 20:25 PDT)

The human has changed the product requirement: tasks carry a posted price; sellers do not set per-task compute prices. A seller accepts the task price by claiming it. Keep the accepted price fixed through settlement. Existing claimed tasks keep their agreed price. Future task prices should respond to market demand and completion evidence; do not claim market equilibrium before measuring it or raise buyer spending caps automatically.

Own the pricing contract, shared types, server enforcement, compatibility and market observations. Publish a decision for B/C/D/E. The proposed explicit field is post_task.price_cents; existing max_price_cents becomes an equal-value compatibility alias. Seller ask_cents must stop determining eligibility or payment. Preserve prices already accepted by a seller. Reject conflicting price fields, reserve the full offer within buyer/job budgets and test races/refunds. Return observations and sample counts before claiming an equilibrium.

Read the newest C-to-A.md message for the handoff. This section takes priority over historical seller ask-price instructions below.

## Completion audit: your next assignment (2026-10-17, 20:05 PDT)

The core marketplace is running, but the full original request is unfinished. This section takes priority over the historical build checklist below. The [completion audit](../docs/COMPLETION-AUDIT.md) gives evidence, assignment IDs and acceptance criteria. Fresh checks on `82d0aa2` passed workspace typecheck, 79 tests and smoke. Earlier real-Wassette and hosted purchase evidence remains valid. No cost benchmark or complete multi-computer job demonstration has been recorded.

Start by fetching the latest `origin/main` and bringing it into your existing feature branch without discarding local work. Read your four inbound files in `coordination/messages/`, then acknowledge this assignment to C in `<YOUR LETTER>-to-C.md` (C records its own progress in its outbound handoffs). C remains acting integrator under A's delegation. Send contract/schema requests to A; C coordinates merges. Do not edit another computer's implementation files without a recorded ownership decision.

Use `MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp` in your private environment. Application health is `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`; dashboard is `http://192.168.4.163:5173/` on C's LAN. Workers use `--poll-ms 5000`. Preserve the running service and existing identities. Do not reset shared Inkbox identities. The Armature buyer has 25 cents available, below the 50-cent new-task minimum; a new buyer or higher cap must not be used to bypass that limit. All current payment evidence is Stripe TEST mode.

### Your work, in order

1. **J1/J2/J3, with E:** publish the judge retry/replacement contract. Enforce safe public explanations on the server, including historical verdict rows; keep infrastructure errors from causing seller strikes or final quality settlement. Preserve recoverable review/replacement status. E owns the judge runner. Acceptance: fake private text stays out of public APIs/notices, and a judge outage recovers without punishing the seller or duplicating settlement.
2. **P1, lead; P2, support D:** compensate a task-insert failure after a hold, and make settlement finalization resumable after each database write. Persist transfer retry status for D. Acceptance: fault-injection tests show no orphaned hold, incorrect reserved balance, double capture/refund, or lost/duplicate reputation update. Source risks are documented in the audit; they were not injected into the live service.
3. **F1, contract first:** define parent job/part identifiers, private payload boundaries, safe progress, budget rules and recovery from ambiguous posts. Publish `docs/CONTRACT.md`, shared types and migration before B/C/D/E depend on them. B leads decomposition and aggregation. Acceptance: one buyer job can have two separately assigned parts without leaking their prompts or exceeding the job cap.
4. **B1/I1:** provide a shared usage/result schema for complete cost measurement; help E persist Inkbox recipients/context through restarts. B owns `scripts/benchmarks/**` for this follow-up, while you retain root scripts, shared types and schema.
5. **L1/D1:** support the hosted server during the physical-computer rehearsal. C integrates under your existing delegation. Refresh stale PLAN/SECURITY/PROGRESS claims with C, especially confidentiality, liveness canaries and blanket replacement delivery. Verify the deployed revision and application health.
6. **X1, later scope:** own the confidential-compute/attestation design with C and production enrollment/payment controls with D. Current Wasm execution does not hide prompts from the machine owner; do not mark this original requirement done.

### Finish and hand off

Work within A's ownership from `AGENTS.md`, coordinate main-branch edits with C, and use `feat/a-*` for changes that need integration. Send C the assignment IDs, branch/SHA, exact test commands/results and remaining gaps. Shared contracts need a DECISION to every affected computer before implementation. Passing existing tests alone does not close the new failure cases.

## Historical handoff (2026-10-17, 19:58 PDT)

C is acting integrator under A-C-20261018T021200Z-02. The v0.2 server, D payments and B buyer kit are merged. Manufact is deployed and the accepted-task Armature run passed. Keep the tested server running; remaining team work is E’s final demo/Inkbox handoff and rehearsal. Coordinate further main-branch edits with C.

Shared MCP endpoint: `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`. Application health: `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`. Public dashboard on C’s LAN: `http://192.168.4.163:5173`. Set `MARKETPLACE_URL` to the hosted endpoint in your private environment. Local agents need `--poll-ms 5000`. All payments are Stripe TEST mode.

Latest completed checks: 79 tests, workspace typecheck and smoke passed; the real-Wassette daemon suite passed 7/7. Three Armature cases passed 5/5 each: accepted purchase, cap rejection and simulated task-ID recovery. Pending-seller and rejected-result cases lack fixtures within the remaining 25-cent cap; see the report for the exact limits. Read your four incoming coordination files before starting; the original implementation checklist below records the build assignment and may describe work that is already complete. Deployment details are in `docs/DEPLOYMENT.md`; evidence is in `docs/PROGRESS.md` and `docs/ARMATURE-RESULTS.md`.

You are **A**: the integration lead. You own the MCP server (`apps/marketplace-mcp`, except the payments and Inkbox modules), `packages/shared`, `packages/crypto`, `docs/`, `scripts/`, root config, and **you own merges into `main` (currently delegated to C)**. You also deploy the server to Manufact and keep `main` runnable at all times.

## 0. Setup (10 min)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
pnpm install && pnpm -r typecheck && pnpm test
# .env from the human; or pnpm setup:env. You need all server keys: INSFORGE_*, STRIPE_SECRET_KEY, INKBOX_API_KEY, SERVER_KEK_B64, JUDGE_PUBLIC_KEY_B64, JUDGE_KEY_ID, JUDGE_REGISTRATION_SECRET.
bash scripts/db-migrate.sh          # idempotent; the schema is already applied to the team's Insforge project
pnpm dev:server --no-open        # http://localhost:3000/mcp
curl -s localhost:3000/health
```

Read `README.md`, `docs/PROGRESS.md`, `docs/CONTRACT.md`, `docs/PLAN.md`, `coordination/README.md`. Then post your LAN address in `A-to-B`, `A-to-C`, `A-to-D`, `A-to-E` so others can point `MARKETPLACE_URL` at your server (or tell them to run their own against the same Insforge project).

## 1. Contract v0.2 for the sandbox fix (with C) — target 19:30

The blocker is in `docs/PROGRESS.md` §6 item 1. Implement the server half of `docs/CONTRACT.md` §7:

1. `claim_task` accepts optional `runner_pubkey_b64` (≥40 chars base64) and `runner_key_id`. When present, seal the seller envelope to that key instead of the registered one and store them on the task (`tasks.claim_runner_key_id`, `tasks.claim_runner_pubkey_b64` — add both columns to `db/schema.sql` as `add column if not exists` and re-run `scripts/db-migrate.sh`). Validate the key decodes to 32 bytes.
2. `claim_task` response adds `buyer_public_key` and `judge_public_key` (`ClaimPublic` in `packages/shared`).
3. `register_seller`: `runner_pubkey_b64` / `runner_key_id` become optional; if absent, the seller must present a per-claim key (reject `claim_task` without one with `INVALID_STATE` + `next_action`).
4. `SellerPublic.runner.public_key` shows the per-claim key id when the registered key is absent.
5. Update `docs/CONTRACT.md` (§3 rows for `claim_task`, `register_seller`; §7 → "adopted") and `packages/shared`. Commit on `main` as `feat(contract): v0.2 per-claim runner keys`, then post `DECISION` with the SHA to C and E (E's judge-cycle uses the same auth pattern).

Files: `apps/marketplace-mcp/src/service.ts` (`claimTask`, `registerSeller`, `toSellerPublic`), `src/tools.ts`, `packages/shared/src/index.ts`, `db/schema.sql`.

## 2. Server hardening — target 21:00

- `expireStale` runs on every read; make sure it cannot throw into a tool (wrap, log once).
- Confirm no log line ever contains prompt/answer/ciphertext/API keys (grep `console.` in `apps/marketplace-mcp/src`).
- Add `list_open_tasks` pagination guard and `max_price_cents` upper bound (100 000).
- Return `next_action` on every 4xx (audit `MarketplaceError` sites).
- Optional: remove the unused `CLAIMED` state from the enum (contract note), or document it.

## 3. Manufact deployment — target 05:00 (start the login early, it is a browser device flow)

```sh
# Run from the repository root; the human approves the device-code login.
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js login
pnpm deploy:manufact --json
```

- See `docs/DEPLOYMENT.md` for status checks and the workspace upload. The script excludes local URLs and daemon credentials from the hosted environment.
- Manufact injects `MCP_URL`; `src/env.ts` derives `baseUrl` from it. Do **not** set `BASE_URL` in the deployed env unless you know the slug.
- Verify from a different machine: `GET https://<slug>.run.mcp-use.com/health`, then `claude mcp add --transport http atm https://<slug>.run.mcp-use.com/mcp --header "Authorization: Bearer <buyer key>"` and call `marketplace_info`.
- Free plan scales to zero and bills `tools/call` ($5 credit ≈ 50k calls): daemons polling every 3 s are fine for the demo window; tell C and E to raise `--poll-ms` to 5000 against the hosted URL.
- Post the hosted URL in all four outbound files.

## 4. Integration merges — continuous

For every `HANDOFF` you receive: fetch the branch, `pnpm -r typecheck && pnpm test`, run the slice against your server, merge into `main` (`git merge --no-ff`), push, and `ACK` with the `main` SHA. Keep a running end-to-end check: `node scripts/buyer.mjs post "What is the capital of Peru? One word." --expect Lima --max 100`, a seller daemon, a judge daemon, `node scripts/buyer.mjs result <task_id>` shows `commitment_verified: true` and `APPROVED`.

Delete the superseded branches on origin once everyone has cloned: `git push origin --delete work/A-api work/B-buyer work/C-seller work/D-security work/E-judge coordination`.

## 5. Final rehearsal — 07:00–09:00

With E's `demo/` script: accepted path, rejected path, two-seller race, denied-host sandbox demo, Stripe dashboard, Inkbox console, hosted URL from Claude Code. Fix only what breaks the demo. Freeze `main` at 09:00.

## Verify and hand off

Each merge: `main` SHA, what was merged, what the end-to-end run printed. Post to the owner's inbound file. Keep `docs/PROGRESS.md` §1 timeline and §6 issues current (you own it).
