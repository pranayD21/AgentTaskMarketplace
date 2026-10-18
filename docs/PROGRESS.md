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
| 18:44 | C asks A for contract v0.2 (`C-A-20261018T014443Z-01`). |
| 18:47 | Computer **A** picks up `tasks/A.md` in a Claude Code **cloud** session (not on the LAN). `pnpm install` + `pnpm -r typecheck` green; `pnpm test` red because `apps/marketplace-mcp` had no test files. The container's egress policy **denies Insforge, Stripe, Inkbox and Manufact** (proxy `connect_rejected`), so nothing in this session touches the team's live services; verification below uses `DB_MODE=memory` + `PAYMENT_MODE=mock`. |
| 18:55 | Found `pnpm daemon --role …` broken under pnpm 10.33: the root script's trailing `--` reached `parseArgs` as a positional. Fixed in root `package.json`; `pnpm dev:server --no-open` (no `--`) is the working form. |
| 19:03 | **Contract v0.2 server side** + server hardening + memory DB + 18 server tests, `pnpm smoke` green (real server, both daemons, per-claim claim). Commit `e7ae1b3` on `claude/zen-mccarthy-0xradq`. |
| 19:06 | `mcp-use build` → `.mcp-use/build/index.js`; `mcp-use start` from the build serves 21 tools (memory mode). Manufact login/deploy not attempted: device flow needs the human's browser and Manufact is not reachable from this container. |
| 19:10 | Merged E's `feat/e-judge-inkbox` (contains C's `feat/c-seller`) onto v0.2: no conflicts; C's `sellerKeyMode()` reads this server as `per-claim`. |
| 19:30 | Spend cap reserved by compare-and-swap before the hold (`7198f51`; 22 server tests). SECURITY.md and README claims corrected: Wassette grants are per hostname not port, there is no liveness canary, plaintext is deleted at submit (not claim), and per-claim keys are not attestation. CONTRACT §6 documents `run-cycle` / `judge-cycle`. |
| 19:15 | GitHub refused pushes (Claude GitHub App not installed on the repo); the human installed it. Branch and `main` pushed. **C is acting integrator** (A-C-20261018T021200Z-02): live Insforge/Stripe check, Manufact deploy, Armature for B, merging D (`f30e441`) and B (`da25251`), rehearsal. |

| 19:25–19:29 (C, acting for A) | Live v0.2 seller and judge both ran in Wassette: task_e6a9f587177d49b4 APPROVED with verified commitment and per-claim key. D payments integrated; Stripe TEST captured and transferred 75c, released 25c. A atomic caps integrated; payment retries and MPP expiry/cap handling tested. LAN MCP is http://192.168.4.163:3000/mcp. Manufact and Armature need human sign-in. |

## 2. Commits on `main`

| sha | subject |
|---|---|
| `32838d5` | feat: scaffold TypeScript monorepo with schemas and sealed envelopes |
| `7c976d7` | feat(marketplace-mcp): MCP server with Insforge state and Stripe holds |
| `dd290a5` | feat(daemon): seller and judge loops with a shared sandbox-side runner core |
| `021eb1e` | feat(sandbox): Wasm runner component, Wassette runtime, buyer CLI |
| `c212dee` | docs: document progress, plan and five-computer split |
| `19f7431` | coord: C requests per-claim runner key support |
| `a74aebc` | feat(contract): v0.2 per-claim runner keys (+ hardening, memory DB, tests, `pnpm smoke`) |
| `7cd723d` | fix(shared): keep v0.2 ClaimPublic fields optional for mixed-version clients |
| `23e7883` | merge feat/e-judge-inkbox (C run-cycle `4cc4fb7`, E judge-cycle `b2f550e`/`5a56963`, Inkbox `8843287`, demo `d1e7054`) |
| `2bdb477` | test(marketplace-mcp): fake Ollama lists models; judge checks submitted commitment |
| `69b8e88` | feat(marketplace-mcp): buyer guidance wording (B) and judge-key guard |
| `bc05530` | merge origin/main (coordination) — `pnpm install --frozen-lockfile`, typecheck, 51 tests (+1 Wassette skipped), `pnpm smoke` green |

## 3. What exists, file by file

### Root
- `package.json` — workspace scripts: `typecheck`, `test`, `build`, `dev:server`, `daemon`, `build:runner`, `setup:env`. `pnpm.onlyBuiltDependencies: ["esbuild"]`.
- `tsconfig.base.json` — strict, NodeNext, `allowImportingTsExtensions`, `noEmit`.
- `.env.example` — every variable with a comment. `.env` is git-ignored and mode 600.
- `scripts/setup-env.sh` — interactive, `read -s` so pasted keys never echo; updates or appends keys; generates `SERVER_KEK_B64` (openssl) and the judge keypair (`scripts/gen-judge-keypair.ts`); prints set/missing per key, never values.
- `scripts/db-migrate.sh` — posts `apps/marketplace-mcp/db/schema.sql` to Insforge's admin raw-SQL endpoint. Idempotent.
- `scripts/buyer.mjs` — buyer CLI without MCP SDK dependency: `post`, `result`, `task`, `tasks`, `whoami`. Registers a buyer once into `.atm-state/buyer.json`.
- `scripts/smoke-local.ts` (`pnpm smoke`) — offline end-to-end check: starts the server on :3917 with `DB_MODE=memory`, `PAYMENT_MODE=mock` and a throwaway KEK + judge keypair, a fake Ollama on :11939 (test double, fixed answer), registers buyer/seller/judge, runs both daemons `--runtime node --once` (v0.1 path), then a v0.2 per-claim claim through the tool layer (no-key → `INVALID_STATE`, 31-byte key → `VALIDATION_ERROR`, sealed-to-key check, judge APPROVE, `commitment_verified`).

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
- `src/tools.ts` — 21 tools (CONTRACT.md §3). Every error is `{error:{code,message,retryable,next_action?}}`. v0.2: `claim_task` takes `runner_pubkey_b64?`/`runner_key_id?`, `register_seller` keys optional, `list_open_tasks` takes `limit?`, `post_task.max_price_cents ≤ 100 000`, `marketplace_info` reports `contract_version` and `storage`.
- `src/memdb.ts` — `DB_MODE=memory`: the PostgREST subset the service uses (`from/select/insert/update`, `eq/in/lt`, `order`, `limit`), tables parsed from `db/schema.sql`; unknown columns, NOT NULL and UNIQUE fail as in Postgres. Labelled `MEMORY` in `/health`, `marketplace_info.storage`, dashboard `db`.
- `test/` — vitest: `service.test.ts` (v0.2 keys, back-compat, APPROVE/REJECT cycles via `runner-core`, race, lease expiry, sweep resilience, bounds), `memdb.test.ts`; `setup.ts` sets memory/mock env and a throwaway judge key.
- `src/routes.ts` — `GET /health`, `GET /api/dashboard` (CORS).
- `src/inkbox.ts` — **stub** (returns null / no-op) with the signatures the service calls.
- `db/schema.sql` — 7 tables + indexes, idempotent. v0.2 adds `tasks.claim_runner_key_id`, `tasks.claim_runner_pubkey_b64`, `sellers.last_claim_key_id`, `sellers.last_claim_pubkey_b64` (`add column if not exists`); `src/db.ts` `ensureSchema` applies the same lines on the first tool call.

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

- **19:03 (cloud A, memory DB + mock payments, no live services):** `pnpm -r typecheck` clean; `pnpm test` → crypto 7/7, marketplace-mcp 18/18. `pnpm smoke` printed:
  ```
  health: contract=0.2 payments=mock db=MEMORY — in-process tables, dev/test only, lost on restart
  [seller] listed qwen3:8b@75c | runtime=node-unsandboxed (UNSANDBOXED …) | key=runner-0cf0a04b4f8d9779 | status=ACTIVE
  [seller] claimed task_… price=75c   [seller] submitted result_… in 13ms
  [judge] APPROVE task_…: RUBRIC_MATCH | payout 75c | mock payout of 75c (no payment rail)
  get_result: APPROVED, commitment_verified=true, settlement MOCK payout 75c refund 25c
  register_seller without key → runner.key_source=none
  claim_task without key → INVALID_STATE (next_action present)
  claim_task with a 31-byte key → VALIDATION_ERROR
  claim_task with key runner-020c… → claim_…, sealed to it, buyer=buyer-… judge=judge-…
  [judge] APPROVE … payout 60c
  get_result: APPROVED, commitment_verified=true; seller runner key runner-020c… (per-claim)
  ✔ smoke passed — buyer spend: reserved 0c, spent 135c of 1000c (MOCK)
  ```
  Not yet run against Insforge + Stripe test mode (container cannot reach them); first server started from this commit on a LAN machine will add the four columns itself.

### Live integration on C, 19:25–19:29

- `pnpm dev:server --no-open --no-inspector --host 0.0.0.0`: LAN `/health` reports contract `0.2`, database `Insforge Postgres`, payments `card`. Remote-computer reachability has been requested from B; the local LAN request succeeds.
- `node scripts/buyer.mjs post "What is the capital of Peru? One word." --expect Lima --max 100` created `task_e6a9f587177d49b4`. `pnpm daemon --role seller --runtime wassette --display-name computer-c-v02 --once --task-id task_e6a9f587177d49b4` logged `key mode=per-claim` and submitted `result_4fcd6cbea2c388b0`.
- `pnpm daemon --role judge --runtime wassette --display-name computer-c-integration-judge --once` approved that result after D's payment integration. `get_result` verifies the commitment; `get_seller_reputation` reports `runner.key_source=per-claim`. Stripe test settlement: 75c captured, 75c transferred, 25c released; transfer `tr_3URjl8F42f8esBiW0fOWPlCB`.
- The first judge attempt picked an older MPP task and reproduced D's wrong-rail capture failure. The integrated router now follows each task's stored mode and refuses settlement if that mode cannot be configured. Payment failures leave the task pending and publish no new verdict.
- `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm test`, `pnpm smoke` passed. `ATM_TEST_WASSETTE=1 pnpm --filter @atm/agent-daemon test` passed 7 tests, including real sandbox denial, restart, timeout, race and fresh-key checks. Component SHA-256: `38f3cd26002156f2ce320ea5d678b9106899363daaf9fd8c3e5c43123a5943c9`.
- Inkbox rejected creation of another identity because the plan has three slots. Existing team identities were preserved; notification creation for this new test seller is unverified.

## 5. Findings worth knowing (saved you an hour each)

- **mcp-use v2:** `import { MCPServer } from "mcp-use"`; tools use `inputSchema` (zod 4 ok), callbacks get `(params, ctx)` with `ctx.request` (Hono request) — read the `Authorization` header there. Custom HTTP routes: `server.get/post(...)` (Hono). The CLI (`mcp-use dev`) imports the entry (`index.ts` / `src/index.ts` / `server.ts`), requires `export default server`, and calls `listen` itself; it loads `.env` from the package dir, hence the symlink `apps/marketplace-mcp/.env → ../../.env`.
- **Insforge:** admin SDK `createAdminClient({ baseUrl, apiKey })` wraps PostgREST (`@supabase/postgrest-js`); `.update().eq().eq().select()` is the atomic claim. Raw SQL: `POST /api/database/advance/rawsql {query}`; anon key: `GET /api/metadata/anon-key`. New tables have RLS on; the admin key bypasses it.
- **Stripe v23 SDK:** `payment_method_types` is no longer in the typed `PaymentIntentCreateParams` → use `automatic_payment_methods: { enabled: true, allow_redirects: "never" }`. `accounts.create({type:"custom"})` now returns an error telling you to use `/v2/core/accounts`; v2 recipient accounts are created but transfers fail until identity requirements are met (Computer D).
- **componentize-js / Wizer:** module top-level runs at build time; any call into `wasi:random` traps. zod (`randomString`) and `@noble/curves` (`probeRandomBytes` in `ScalarMultiplier`) do that → shim both during build, restore at first export call. `--external:wasi:*` must be quoted in zsh. jco needs `@napi-rs/lzma-<platform>` which pnpm skipped.
- **Wassette 0.8:** `wassette run` is MCP over stdio; component id = file stem; results come back as `{"result": …}`, `result<T,E>` as `{ok}`/`{err}`; it reports server version `3.5.0` over MCP. **A new instance per tool call** → no in-memory state between calls (the blocker below). Network permission is host(:port); env permission surfaces variables through `wasi:config/store`.
- **Ollama 0.40:** `/api/chat` with `think:false` suppresses qwen3 reasoning; `eval_count` gives output tokens.
- **pnpm 10:** a root script ending in `--` (`pnpm --filter x start --`) forwards a literal `--` to the child, and `node:util` `parseArgs` then rejects every flag as positional. Write `pnpm daemon --role seller` / `pnpm dev:server --no-open`, no extra `--`.
- **mcp-use build** imports the entry module to collect the manifest, so module top-level side effects run at build time. Keep startup work lazy (that is why `ensureSchema` runs on the first tool call, not at import).
- **`node --env-file`**: variables already in the environment win over the file, so `JUDGE_PRIVATE_KEY_B64= pnpm daemon …` blanks a value from `.env` for one run.

## 6. Known issues / open items

Updates 19:06 (A): item 1 server half **done** (contract v0.2, `e7ae1b3`); item 7 documented in CONTRACT §2 (reserved, never written); item 8 resolved by `SellerPublic.runner.key_source`; items 9–13 new.

1. **[BLOCKER, C+A] Wassette per-call instance loses the runner keypair.** `get-public-key` and `run-task` run in different instances → `invalid tag` on decrypt. Fix: runner-driven single call (`run-cycle` / `judge-cycle`) that claims, decrypts, runs and submits inside one instance, with the marketplace host added to the network grant and `AGENT_API_KEY` to the env grant; server accepts a per-claim `runner_pubkey_b64` on `claim_task` and returns buyer + judge public keys. See PLAN §5 and tasks/C.md, tasks/A.md.
2. **[D] Seller payouts:** Stripe Accounts v2 recipient accounts are created (`acct_…`) but `transfers.create` fails until `configuration.recipient.capabilities.stripe_balance.stripe_transfers` is active (identity/onboarding). Currently recorded as `PENDING_ONBOARDING` in `settlements.note`.
3. **[E] Inkbox** is a stub; nothing is created or sent yet.
4. **[B] No dashboard UI, no SKILL.md/llms.txt**, Claude Code connection not yet exercised end to end by a real agent (only by `scripts/buyer.mjs`).
5. **[A] Not deployed to Manufact yet**; `mcp-use login` / `deploy --no-github` untested.
6. Judge model default is `claude-opus-5-5` with `effort: low`; swap via `JUDGE_MODEL` if cost/latency matters.
7. `CLAIMED` state exists in the enum but is never used (claim goes straight to `PAYLOAD_READY`); harmless, could be removed in a contract revision.
8. The seller's `register_seller` runner key becomes advisory once per-claim keys land (issue 1); the dashboard should show the per-claim key id instead.
9. **[C — FIXED in `4cc4fb7`; server guard in `69b8e88`] Node runtime seller used the judge keypair as its runner key.** `apps/agent-daemon/src/main.ts` constructs `NodeRuntime(process.env.JUDGE_PRIVATE_KEY_B64)` for both roles, and `pnpm daemon` loads the root `.env`, so on any machine holding the shared `.env` the seller registers `runner-0d5c3e52…` = the judge key id. Fix: pass the judge key only when `role === "judge"`. Related operational rule: only the judge machine should hold `JUDGE_PRIVATE_KEY_B64` and `ANTHROPIC_API_KEY`. Once C's fix is on `main`, A will make the server refuse a runner key equal to the judge key.
10. **[D] `payments.ts`** has two `PAYMENT_FAILED` errors without `next_action` (Stripe refused the hold; unexpected PaymentIntent status).
11. **[A — FIXED in `7198f51`] Spend-cap check was not atomic.** `post_task` checks `reserved + spent + max ≤ cap` on the row read at auth time and `adjustBuyerBalance` is read-modify-write, so two concurrent posts from one buyer could both pass. Low risk for the demo (one buyer agent, sequential posts); fix with a conditional update if time allows.
12. **[A] Live verification pending.** This session's container cannot reach Insforge/Stripe/Inkbox/Manufact; v0.2 is verified against the memory DB and mock payments only. Needs one run of `node scripts/buyer.mjs post … --expect Lima` + both daemons against Insforge + Stripe test mode on a LAN machine.
13. **[A] Manufact deploy** still needs the human's browser login (`npx -y mcp-use@latest login`); `pnpm build` and `mcp-use start` from the build are verified.

### Integration update from C (19:29)

Earlier issues above are historical. The per-call key blocker (#1), D payout integration (#2), payment error guidance (#10), and live v0.2 verification (#12) are resolved by the integration described in §4. E's Inkbox code is merged; its account identity limit remains an operational constraint. Manufact deployment and Armature evaluation still require the human account sign-ins.


### Hosted integration update from C (19:46 PDT)

- Manufact is live at https://warm-cloud-4hh5i.run.mcp-use.com/mcp. Device sign-in succeeded. Server `1cb4bcbc-3f2a-4ae3-8d7b-6c86aaa5624a`; first successful deployment `4df23d0c-9188-449e-9033-256c3b2fff2b`. Server-only build commands avoid building the Wasm toolchain on the cloud host.
- Deployment `f2926ebf-1602-4df9-ad55-56ffb7791dad` adds `/api/health`, because `mcp-use start` supplies its own `/health` response. Verified at 02:45:09 UTC: `contract=0.2`, `payments=card`, `db=Insforge Postgres`, `base_url=https://warm-cloud-4hh5i.run.mcp-use.com`. No local `BASE_URL` was uploaded.
- Public MCP discovery and `/api/dashboard` passed. C's existing seller and judge now poll the hosted endpoint every 5000 ms. B is checking the endpoint independently and updating its hosted recipes.
- Armature accepted-task run `e7b625cc-1d27-5d05-ba0a-4b1e178e4612` passed 5/5, all three criteria, through Codex / GPT-5.6 Terra. `task_19a38f56a2162259` reached APPROVED with a verified commitment; 75c Stripe TEST captured and transferred, 25c released. See [the redacted report](ARMATURE-RESULTS.md). The other four prepared Armature cases have not run.
- D's follow-up `0cb3ff2` is merged at `5f2b6b3`, preserving C's payment retry/cap/expiry fixes. `pnpm -r typecheck`, `pnpm test` (79 passed, one optional Wassette case skipped), and `pnpm smoke` passed. The separate real-Wassette suite passed 7/7 earlier.
- Live challenge check after D's merge: `task_8cd7ec26e3507379` returned HTTP 402 twice with identical challenge headers, then was cancelled before payment. The hosted judge started with `--deny-marketplace --once` logged `HTTP request blocked by network policy` and exited 1, as expected.
- E acknowledged the handoff and is waiting on its human before updating the demo and checking notices with existing Inkbox identities. No shared Inkbox reset was run. The earlier deployment/sign-in blockers (#5 and #13) are resolved. The scheduled team rehearsal and E's final notice check remain.


### Final hosted checks from C (19:58 PDT)

- B handoff `22c771f` / PR #2 merged at `a0b4c37`: hosted recipes and accepted-case evidence. Workspace typecheck, 79 tests (one optional Wassette skip), and smoke passed on the combined tree. The subsequent incoming merge changed only coordination messages.
- Current Manufact deployment `eaba52dd-79b3-4853-8988-2ba57132b53d` is running. `/api/health` passed at 02:51 UTC; B independently verified discovery and health. Existing local Wassette seller and judge remain connected to the hosted server.
- Armature now has three passing scenarios: accepted purchase, cap rejection and simulated task-ID recovery, each 5/5 across three criteria. Recovery was rerun after correcting its fixture description; this is four runs across three scenarios. See [the detailed report](ARMATURE-RESULTS.md).
- Follow-ups added no marketplace charges. Original buyer: 75c spent, 0 reserved, 25 available; one approved task, no OPEN or REJECTED fixture. Pending-seller and rejected-result cases remain unrun because the available cap is below the 50c minimum for a new fixture. No identity or cap bypass was used.
- E’s final demo and Inkbox notice handoff is still awaiting its human. The team rehearsal and recording remain outstanding.
