# Progress log — what has been built, verified, and learned

Maintained by Computer A. Append; do not rewrite history. Times are PDT, Oct 17 2026 unless noted. Deadline: **10:00 AM Oct 18**.

## 1. Timeline

| time | what happened |
|---|---|
| 16:50–17:15 | Research: event page (sponsors, prizes, schedule), docs for mcp-use/Manufact, Wassette, componentize-js, Stripe (MPP, Link CLI, Connect, manual capture), Insforge, Inkbox, Primitive, Blaxel, x402. Plan approved. |
| 17:20 | Repo cloned to `~/Documents/AgentTaskMarketplace`. `brew install ollama wassette` (ollama 0.40.6, wassette 0.8.0). `ollama pull qwen3:8b` (5.2 GB). |
| 17:30 | Legacy Python 5-computer plan removed. pnpm monorepo scaffold, `packages/shared`, `packages/crypto` (6 tests pass). Commit `32838d5`. |
| 18:00 | `.env` populated via `scripts/setup-env.sh` (Insforge, Stripe, Inkbox, Anthropic keys pasted silently; server KEK + judge X25519 keypair generated). Insforge anon key fetched from `GET /api/metadata/anon-key`; `JUDGE_REGISTRATION_SECRET` generated. |
| 18:05 | Schema applied to Insforge via `POST /api/database/advance/rawsql` (7 tables). |
| 18:16 | `apps/marketplace-mcp` running (`mcp-use dev`). Smoke test: 20 tools listed; `register_agent(buyer)` → Stripe customer `cus_…`; `post_task` → 100c hold `pi_…`, task `OPEN`, spend cap accounting correct. Commit `7c976d7`. |
| 18:21 | `apps/agent-daemon` (Node runtime): seller registered, claimed, ran qwen3:8b in 5 047 ms, submitted sealed result; judge decrypted, verified commitment, **APPROVE**; Stripe captured 75c of the 100c hold, remainder released; settlement + verdict + 8 events recorded. Commit `dd290a5`. |
| 18:24–18:28 | `packages/runner-wasm` builds after fixing (a) missing native `@napi-rs/lzma-darwin-arm64`, (b) Wizer snapshot trapping on `wasi:random` because zod and noble-curves touch randomness at import time → `src/wizer-shim.ts`. Output `dist/runner.wasm` 20.6 MB, sha256 `7bf3a544…`. |
| 18:29 | Wassette runtime driver written. Seller daemon with `--runtime wassette`: component **loaded** under Wassette (reported server version 3.5.0), tools `get-public-key`, `run-task`, `judge-task` visible, network grants applied, seller registered with in-sandbox key `runner-2802…`, task **claimed**, then `run-task` failed: `invalid tag` (see Known issues #1). Task released and reopened automatically. |
| 18:32 | Work paused to document and split across five computers (this file, PLAN, CONTRACT, SECURITY, AGENTS, tasks/, coordination/). |

## 2. Commits on `main`

| sha | subject |
|---|---|
| `32838d5` | feat: scaffold TypeScript monorepo with schemas and sealed envelopes |
| `7c976d7` | feat(marketplace-mcp): MCP server with Insforge state and Stripe holds |
| `dd290a5` | feat(daemon): seller and judge loops with a shared sandbox-side runner core |
| (next) | docs + runner-wasm + Wassette runtime + buyer CLI + Stripe Accounts v2 onboarding (this push) |

## 3. What exists, file by file

### Root
- `package.json` — workspace scripts: `typecheck`, `test`, `build`, `dev:server`, `daemon`, `build:runner`, `setup:env`. `pnpm.onlyBuiltDependencies: ["esbuild"]`.
- `tsconfig.base.json` — strict, NodeNext, `allowImportingTsExtensions`, `noEmit`.
- `.env.example` — every variable with a comment. `.env` is git-ignored and mode 600.
- `scripts/setup-env.sh` — interactive, `read -s` so pasted keys never echo; updates or appends keys; generates `SERVER_KEK_B64` (openssl) and the judge keypair (`scripts/gen-judge-keypair.ts`); prints set/missing per key, never values.
- `scripts/db-migrate.sh` — posts `apps/marketplace-mcp/db/schema.sql` to Insforge's admin raw-SQL endpoint. Idempotent.
- `scripts/buyer.mjs` — buyer CLI without MCP SDK dependency: `post`, `result`, `task`, `tasks`, `whoami`. Registers a buyer once into `.atm-state/buyer.json`.

### `packages/shared` (`@atm/shared`)
zod 4 schemas and constants used everywhere: `TASK_STATUSES`, `ACTIVE_CLAIM_STATUSES`, `LEASE_SECONDS=300`, `KeyDescriptor`, `Envelope`, `Rubric` (`contains_text` | `llm_rubric`), `SellerPayload`, `JudgePayload`, `ResultPlaintext`, `RunTaskOutput`, `JudgeTaskOutput`, `Verdict`, `VERDICT_REASON_CODES`, `ModelInfo`, `MODEL_ALLOWLIST` (qwen3:8b/4b/14b, qwen2.5:7b, qwen2.5-coder:7b, llama3.1:8b, gemma3:4b/12b, deepseek-r1:8b, mistral:7b), `TaskPublic`, `SellerPublic`, `ClaimPublic`, `ERROR_CODES`, `MarketplaceError` (code, status, retryable, next_action, `toJSON()`), `nowIso`, `plusSecondsIso`, `isPast`.

### `packages/crypto` (`@atm/crypto`)
Pure-JS so it runs in Node **and** inside the Wasm component. `generateKeypair`, `keypairFromSecretB64`, `keyDescriptor`, `keyIdFor` (sha256 prefix), `seal(recipient, bytes)` → envelope `{alg:"x25519-hkdf-xchacha20poly1305-v1", recipient_key_id, epk_b64, nonce_b64, ct_b64}`, `open`, `sealJson`/`openJson`, `canonicalJson` (sorted keys, undefined dropped), `sha256Hex`, `commitment(result)` → `{bytes, sha256_hex}`, `randomB64`, `sealSymmetric`/`openSymmetric` (server KEK), base64 via `btoa`/`atob`. Tests: round-trip, wrong key fails, tamper fails, keypair restore, commitment order-independence, canonical nesting.

### `packages/runner-core` (`@atm/runner-core`)
`createRunner(host: {fetch, getSecret, now}, existingKeypair?)` → `{ getPublicKey, runTask(sellerEnvelope, opts), judgeTask(taskEnvelope, resultEnvelope, opts, judgeKey) }`. Keypair generated lazily. `runTask` decrypts `SellerPayload`, POSTs `/api/chat` to Ollama (`stream:false`, `think:false`, `num_predict=max_tokens`, temperature 0.2), builds `ResultPlaintext` with a fresh salt, seals the identical canonical bytes to buyer and judge, returns `RunTaskOutput`. `judgeTask` decrypts both judge copies, recomputes the commitment, checks task id, grades (`contains_text` deterministic; `llm_rubric` via Anthropic Messages API, model `claude-opus-5-5` default, `output_config.effort: low`, refusal stop reason handled), and on REJECT produces a replacement answer sealed to the buyer. Uses raw `fetch` deliberately (no SDK can load inside the component).

### `packages/runner-wasm` (`@atm/runner-wasm`)
- `wit/world.wit` — `package atm:runner@0.1.0; world runner { import wasi:config/store@0.2.0-rc.1; export get-public-key: func() -> string; export run-task: func(seller-envelope: string, opts: string) -> result<string,string>; export judge-task: func(task-envelope: string, result-envelope: string, opts: string) -> result<string,string>; }`. `wit/deps/wasi-config-0.2.0-rc.1/` copied from Wassette's `examples/get-weather-js`.
- `src/component.ts` — entry: lazy runner instance, JSON in/out, `result<string,string>` mapped to return/throw string, secrets read via `wasi:config/store` `get()` (`JUDGE_PRIVATE_KEY_B64`, `ANTHROPIC_API_KEY`).
- `src/wizer-shim.ts` — imported first; deterministic stand-ins for `Math.random` (zod ids) and `crypto.getRandomValues` (noble-curves `probeRandomBytes` self-test) **during the Wizer build snapshot only**; `restoreRandom()` runs on the first real export call before any key is generated.
- Build: `esbuild src/component.ts --bundle --format=esm --platform=neutral --external:wasi:* → dist/component.js` then `jco componentize dist/component.js --wit ./wit --world-name runner -o dist/runner.wasm`; `dist/runner.wasm.sha256` written. componentize-js 0.23.0, jco 1.39.0, plus `@napi-rs/lzma-darwin-arm64` (pnpm had skipped the optional native binding).
- `policies/seller.policy.yaml` (network `localhost:11434`, `127.0.0.1:11434`), `policies/judge.policy.yaml` (network `api.anthropic.com`; env `ANTHROPIC_API_KEY`, `JUDGE_PRIVATE_KEY_B64`). The daemon applies the same grants at runtime via Wassette's permission tools.

### `apps/marketplace-mcp` (`@atm/marketplace-mcp`)
- `index.ts` — `new MCPServer({ name:"agent-task-marketplace", version, description, basePath:"/mcp" })`; `registerTools`; `registerRoutes`; `export default server` (the mcp-use CLI calls `listen`).
- `src/env.ts` — zod-validated env; refuses to start without a Stripe key unless `PAYMENT_MODE=mock`; derives `baseUrl` from `BASE_URL` or Manufact's injected `MCP_URL`.
- `src/db.ts` — Insforge admin client (`createAdminClient({ baseUrl, apiKey })`, PostgREST builder), row types, `unwrap`, `one`, `rawSql` (admin endpoint), `logEvent`.
- `src/kek.ts` — `kekSeal`/`kekOpen` with `SERVER_KEK_B64`.
- `src/auth.ts` — `hashApiKey` (sha256), `extractApiKey` (Bearer header via `ctx.request`, `x-api-key`, or `api_key` param), `requireActor(ctx, params, kinds)`.
- `src/ids.ts` — `newId(prefix)`, `newApiKey()` (`atm_sk_` + 32 random bytes base64url).
- `src/payments.ts` — `PaymentProvider` interface; `MockProvider`; `StripeCardProvider` (refuses non-`sk_test_` keys; customer + `pm_card_visa`; manual-capture hold; capture + transfer; cancel; **Accounts v2 recipient onboarding** `stripe.v2.core.accounts.create({... configuration.recipient.capabilities.stripe_balance.stripe_transfers ...})` because Stripe now rejects `type:"custom"` v1 accounts).
- `src/service.ts` — the state machine: `registerAgent`, `registerSeller` (retries connected-account onboarding when missing), `postTask`, `listTasksForBuyer`, `getTaskForActor`, `getResultForBuyer` (decrypts with the server-held buyer key, verifies commitment, surfaces replacement answer), `cancelTask`, `listOpenTasksFor`, `claimTask` (atomic), `recipientKeys`, `renewLease`, `startTask`, `releaseTask`, `submitResult`, `fetchReviewPackage` (atomic SUBMITTED→JUDGING), `submitVerdict` (capture/transfer or release; approvals/rejections/strikes/suspension; idempotent via unique settlement), `expireStale` (listings, leases, stuck JUDGING > 10 min), `listSellers`, `sellerReputation`, `dashboard`.
- `src/tools.ts` — 21 tools (CONTRACT.md §3). Every error is `{error:{code,message,retryable,next_action?}}`.
- `src/routes.ts` — `GET /health`, `GET /api/dashboard` (CORS).
- `src/inkbox.ts` — **stub** (returns null / no-op) with the signatures the service calls.
- `db/schema.sql` — 7 tables + indexes, idempotent.

### `apps/agent-daemon` (`@atm/agent-daemon`)
- `src/main.ts` — CLI: `--role seller|judge`, `--runtime wassette|node` (default `ATM_RUNTIME` or wassette), `--model <tag>` (repeatable), `--ask-cents` (default 75), `--display-name`, `--poll-ms` (3000), `--once`. Registers once (`.atm-state/<role>.json`, or `AGENT_API_KEY`). Seller loop: inventory → `register_seller` → poll `list_open_tasks` → `claim_task` → `start_task` → `get_recipient_keys` → `rt.runTask` (lease renewed every 120 s) → `submit_result`; on failure `release_task`. Judge loop: `fetch_review_package` → `rt.judgeTask` → `submit_verdict`.
- `src/marketplace.ts` — MCP client (`@modelcontextprotocol/sdk` StreamableHTTP + Bearer header); parses tool JSON; rethrows `MarketplaceError`.
- `src/ollama.ts` — `GET /api/tags` → `{model_id, digest, size_gb}`.
- `src/runtime/types.ts` — `Runtime` interface (`info`, `getPublicKey`, `runTask`, `judgeTask`, `close`).
- `src/runtime/node.ts` — in-process runner core; reports `node-unsandboxed`.
- `src/runtime/wassette.ts` — spawns `wassette run --component-dir .atm-state/wassette-<role> [--env K=V…]` over MCP stdio; copies `runner.wasm` to `atm-<role>-runner.wasm` so each role has its own component id/policy; `load-component`, `grant-network-permission`, `grant-environment-variable-permission`; calls component tools; unwraps `{result}` / `{ok|err}` envelopes; surfaces Wassette stderr lines containing denied/error/warn.

## 4. Verified behaviour (evidence)

- `GET /health` → `{"ok":true,"payments":"card",...}`.
- `tools/list` → 21 tools.
- `register_agent(buyer, cap 1000c)` → `buyer_2cdb93c6…`, Stripe `cus_VSe0SGHkYSwjgx`.
- `post_task(qwen3:8b, max 100c, contains_text "Paris")` → `task_bf9a69fcd05eb034` `OPEN`, `payment.state HELD`, `pi_3URiihF42f8esBiW11Zoe2AG`; `whoami` → reserved 100c, available 900c.
- Seller (node): `listed qwen3:8b@75c … key=runner-0d5c3e529407c967`; `claimed task_bf9a… price=75c lease=+300s`; `submitted result_9d873b285f89402f in 5047ms (2 tokens); commitment 28b6368c3db7…`.
- Judge (node): `APPROVE task_bf9a…: RUBRIC_MATCH | payout 75c | seller ACTIVE | captured 75c of the 100c hold (pi_3URiih…); remainder released; seller has no connected account (payout PENDING_ONBOARDING)`.
- Dashboard: `counts {APPROVED:1}`, settlement `kind STRIPE_TEST`, `stripe_capture_id ch_3URiihF42f8esBiW1u7OTjOZ`, events `agent.registered ← seller.registered ← task.claimed ← task.running ← result.submitted ← agent.registered ← task.judging ← verdict.recorded`.
- Wasm: `jco componentize` → `OK Successfully written dist/runner.wasm`; Wassette: `loaded atm-seller-runner (sha256 7bf3a544e6e7…) tools: get-public-key, run-task, judge-task, get-policy`; seller registered with `runtime=wassette`, key `runner-2802469df3c96149`; claimed `task_d7575f5ac20408ea`; `run-task` → `invalid tag`.

## 5. Findings worth knowing (saved you an hour each)

- **mcp-use v2:** `import { MCPServer } from "mcp-use"`; tools use `inputSchema` (zod 4 ok), callbacks get `(params, ctx)` with `ctx.request` (Hono request) — read the `Authorization` header there. Custom HTTP routes: `server.get/post(...)` (Hono). The CLI (`mcp-use dev`) imports the entry (`index.ts` / `src/index.ts` / `server.ts`), requires `export default server`, and calls `listen` itself; it loads `.env` from the package dir, hence the symlink `apps/marketplace-mcp/.env → ../../.env`.
- **Insforge:** admin SDK `createAdminClient({ baseUrl, apiKey })` wraps PostgREST (`@supabase/postgrest-js`); `.update().eq().eq().select()` is the atomic claim. Raw SQL: `POST /api/database/advance/rawsql {query}`; anon key: `GET /api/metadata/anon-key`. New tables have RLS on; the admin key bypasses it.
- **Stripe v23 SDK:** `payment_method_types` is no longer in the typed `PaymentIntentCreateParams` → use `automatic_payment_methods: { enabled: true, allow_redirects: "never" }`. `accounts.create({type:"custom"})` now returns an error telling you to use `/v2/core/accounts`; v2 recipient accounts are created but transfers fail until identity requirements are met (Computer D).
- **componentize-js / Wizer:** module top-level runs at build time; any call into `wasi:random` traps. zod (`randomString`) and `@noble/curves` (`probeRandomBytes` in `ScalarMultiplier`) do that → shim both during build, restore at first export call. `--external:wasi:*` must be quoted in zsh. jco needs `@napi-rs/lzma-<platform>` which pnpm skipped.
- **Wassette 0.8:** `wassette run` is MCP over stdio; component id = file stem; results come back as `{"result": …}`, `result<T,E>` as `{ok}`/`{err}`; it reports server version `3.5.0` over MCP. **A new instance per tool call** → no in-memory state between calls (the blocker below). Network permission is host(:port); env permission surfaces variables through `wasi:config/store`.
- **Ollama 0.40:** `/api/chat` with `think:false` suppresses qwen3 reasoning; `eval_count` gives output tokens.

## 6. Known issues / open items

1. **[BLOCKER, C+A] Wassette per-call instance loses the runner keypair.** `get-public-key` and `run-task` run in different instances → `invalid tag` on decrypt. Fix: runner-driven single call (`run-cycle` / `judge-cycle`) that claims, decrypts, runs and submits inside one instance, with the marketplace host added to the network grant and `AGENT_API_KEY` to the env grant; server accepts a per-claim `runner_pubkey_b64` on `claim_task` and returns buyer + judge public keys. See PLAN §5 and tasks/C.md, tasks/A.md.
2. **[D] Seller payouts:** Stripe Accounts v2 recipient accounts are created (`acct_…`) but `transfers.create` fails until `configuration.recipient.capabilities.stripe_balance.stripe_transfers` is active (identity/onboarding). Currently recorded as `PENDING_ONBOARDING` in `settlements.note`.
3. **[E] Inkbox** is a stub; nothing is created or sent yet.
4. **[B] No dashboard UI, no SKILL.md/llms.txt**, Claude Code connection not yet exercised end to end by a real agent (only by `scripts/buyer.mjs`).
5. **[A] Not deployed to Manufact yet**; `mcp-use login` / `deploy --no-github` untested.
6. Judge model default is `claude-opus-5-5` with `effort: low`; swap via `JUDGE_MODEL` if cost/latency matters.
7. `CLAIMED` state exists in the enum but is never used (claim goes straight to `PAYLOAD_READY`); harmless, could be removed in a contract revision.
8. The seller's `register_seller` runner key becomes advisory once per-claim keys land (issue 1); the dashboard should show the per-claim key id instead.
