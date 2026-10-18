# Computer A — marketplace server, contract, integration, Manufact deployment

You are **A**: the integration lead. You own the MCP server (`apps/marketplace-mcp`, except the payments and Inkbox modules), `packages/shared`, `packages/crypto`, `docs/`, `scripts/`, root config, and **you are the only one who merges into `main`**. You also deploy the server to Manufact and keep `main` runnable at all times.

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
