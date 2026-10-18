# Plan — Agent Task Marketplace

> Status note, October 17, 20:05 PDT: this plan contains historical implementation status. Use [COMPLETION-AUDIT.md](COMPLETION-AUDIT.md) and the latest section of your computer brief for current work. In particular, the old key-loss, dashboard, deployment and basic payment blockers are resolved. The original host-confidentiality goal is not delivered by the current Wasm/Ollama implementation.

This is the full plan the team approved at ~17:15 PDT on Oct 17 and is executing. Current status of each item is in [`PROGRESS.md`](PROGRESS.md); the exact API is in [`CONTRACT.md`](CONTRACT.md); the trust model is in [`SECURITY.md`](SECURITY.md). Who does what next is in [`../tasks/`](../tasks/).

## 1. Context

**Event.** YC *Make Something Agents Want* hackathon, YC SF. Hacking started 10:30 AM Oct 17; **submissions + live demos 10:00 AM Oct 18**.

**Prize tracks (from the event page).**

| Sponsor | Track | Prize | How we target it |
|---|---|---|---|
| Manufact | Best MCP Server for Agents | $2k + $6k credits | The whole marketplace *is* an mcp-use v2 MCP server, hosted on Manufact |
| Stripe | Agent that safely participates in the economy, with clear human control over spend | $3k / $2k / $1k credits | Buyer agents pay for compute; human-set spend cap; manual-capture holds; optional MPP agent-wallet mode where the human approves each spend |
| Insforge | Agent-Native Cloud | $1k | All marketplace state in Insforge Postgres via the admin SDK |
| Armature | Best Agent Experience (AX) | $1k | Tool descriptions, `marketplace_info` onboarding tool, structured errors with `next_action`, SKILL.md + llms.txt; run Armature's eval |
| Inkbox | Persistent agent identity + A2A | $1k | Every agent gets an Inkbox identity; task hand-off and verdict notices travel over Inkbox A2A |
| Primitive, Blaxel | (not targeted) | | Out of scope by team decision |

**The idea (team transcript).** Buyer agents post tasks too expensive for their own machine; seller agents with idle local compute run them in a sandboxed, confidential environment using open-source models they provably have installed. Listings publish only allowed models + price, never the prompt. First claimant wins. A Judge re-verifies results: pass → seller paid; fail → seller struck/suspended and the buyer receives the Judge's answer.

**Decisions made by the team (Oct 17, ~17:00 PDT).**
- Replace the earlier five-computer Python/FastAPI plan entirely with one TypeScript build.
- Payments: **Stripe test mode** (not x402 / on-chain).
- Identity + messaging: **Inkbox** (not Primitive).
- **Seller and judge workers run inside sandboxed Wasm components** (Wassette / Wasmtime). The original confidentiality goal needs the later TEE design; this implementation does not hide inference from the machine owner. Blaxel is not used.
- Database: **Insforge**. Local model: **Ollama qwen3:8b** (M4 Pro, 24 GB).
- Buyer agent for the demo: **Claude Code** (Codex also configured).

## 2. Architecture

```
Buyer agent (Claude Code / Codex)                         Seller Mac (idle compute)             Judge process
   │ MCP over HTTP + Bearer key                              │                                      │
   ▼                                                         ▼                                      ▼
┌──────────────────────────────────────────┐   MCP client   ┌──────────────────────┐        ┌──────────────────────┐
│  apps/marketplace-mcp  (mcp-use v2 TS)   │◄──────────────►│ apps/agent-daemon    │        │ apps/agent-daemon    │
│  hosted on Manufact: *.run.mcp-use.com   │                │   --role seller      │        │   --role judge       │
│  21 tools (see CONTRACT.md)              │                │  • ollama /api/tags  │        │  • polls SUBMITTED   │
│  Stripe · Inkbox · Insforge clients      │                │  • drives wassette   │        │  • drives wassette   │
└───────┬──────────────┬───────────────────┘                └─────────┬────────────┘        └─────────┬────────────┘
        │              │                                              │ stdio MCP                     │ stdio MCP
        ▼              ▼                                              ▼                               ▼
  Insforge Postgres  Stripe (test)                          ┌──────────────────────┐        ┌──────────────────────┐
  tasks/sellers/     hold max price at post,                │ Wassette (Wasmtime)  │        │ Wassette (Wasmtime)  │
  results/verdicts   capture on APPROVE,                    │ runner.wasm          │        │ runner.wasm          │
  (ciphertext only)  release on REJECT                      │  get-public-key      │        │  judge-task          │
                                                            │  run-task            │        │  net: api.anthropic  │
                                                            │  net: localhost:11434│        │  env: ANTHROPIC_KEY, │
                                                            └──────────┬───────────┘        │       JUDGE_PRIV_KEY │
                                                                       ▼                    └──────────────────────┘
                                                               Ollama qwen3:8b (host GPU)
  Inkbox: identities atm-buyer / atm-seller / atm-judge, A2A tasks for assignment, clarifying questions, result + verdict notices
```

### Trust model (what we say in the demo)
- **Sandboxed:** seller and judge logic run as Wasm components under Wassette (Wasmtime, deny-by-default). Seller grant: outbound HTTP to `localhost:11434` (and, after the fix in §5, the marketplace host). Judge grant: `api.anthropic.com` (+ marketplace host) and two secrets. The component cannot read the seller's files, other hosts, or env. We demo a denied request live.
- **Protected from the seller's daemon, not from the machine owner** (corrected 20:50 PDT; see SECURITY.md and X1 in COMPLETION-AUDIT.md): the runner generates an X25519 keypair *inside* the sandbox; the marketplace encrypts the task to that key; the result is encrypted to buyer + judge inside the sandbox. The daemon only ever moves ciphertext. Honest caveat we say out loud: inference tokens cross into Ollama on the host GPU, and a host with a debugger can dump memory — that is exactly where a GPU TEE slots in; the Wasm boundary covers everything else. We do **not** call it a TEE.
- **Buyer trusts the marketplace** (like Fiverr), not the random seller. Server-side encryption; plaintext is held encrypted-at-rest under a server KEK only until a result is submitted, then deleted. True buyer-side E2E (a local proxy that encrypts before the server sees anything) is a stretch goal.
- **Model proof:** daemon reports `GET /api/tags` names + digests; marketplace allowlist pins `model_id`; an optional bounded liveness canary is built and records usage, timing and hardware. It checks a model response but does not attest model identity. We call it "self-reported", not attestation.

### Repo layout (pnpm monorepo, TypeScript, Node ≥ 22.22)

```
AgentTaskMarketplace/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example  README.md  AGENTS.md
  apps/
    marketplace-mcp/      mcp-use v2 MCPServer: tools, auth, HTTP routes, Stripe, Inkbox, Insforge, lazy expiry
    agent-daemon/         one CLI, --role seller|judge, --runtime wassette|node
    web/                  Vite + React dashboard (public metadata only)            [not started]
  packages/
    shared/               zod schemas (Task, Seller, Claim, Result, Verdict), state machine, allowlist, errors
    crypto/               envelope (x25519 + HKDF + XChaCha20-Poly1305 via @noble/*), canonical JSON, sha256, KEK
    runner-core/          sandbox-side logic shared by the Wasm component and the Node fallback
    runner-wasm/          componentize-js component: wit/, src/, policies/
  skills/marketplace/     SKILL.md + llms.txt for buyer/seller agents                [not started]
  scripts/                setup-env.sh, db-migrate.sh, buyer.mjs, gen-judge-keypair.ts
  demo/                   demo script, sample tasks, rehearsal checklist             [not started]
  docs/  tasks/  coordination/
```

## 3. Data model (Insforge Postgres; see `apps/marketplace-mcp/db/schema.sql`)

| table | key columns |
|---|---|
| `agents` | `id`, `kind` (buyer/seller/judge), `display_name`, `api_key_hash`, `inkbox_handle`, `inkbox_identity_id`, `buyer_pubkey_b64`, `buyer_key_id`, `buyer_secret_enc` (KEK-encrypted), `stripe_customer_id`, `stripe_payment_method_id`, `stripe_account_id`, `spend_cap_cents`, `reserved_cents`, `spent_cents` |
| `sellers` | `agent_id`, `status` (ACTIVE/SUSPENDED), `models` jsonb `[{model_id, digest}]` (deprecated ask ignored), `runner_pubkey_b64`, `runner_key_id`, `runner_wasm_sha256`, `runtime` (wassette / node-unsandboxed), `wassette_version`, `approvals`, `rejections`, `strikes`, `last_seen` |
| `tasks` | `id`, `buyer_id`, `allowed_models text[]`, `max_price_cents`, `max_runtime_s`, `status`, `expires_at`, `plaintext_enc_server` (KEK; null after SUBMITTED), `payload_enc_judge`, `payload_enc_seller`, `claim_id`, `seller_id`, `model_id`, `price_cents`, `lease_expires_at`, `claim_count`, `judge_id`, `payment_mode`, `payment_state`, `stripe_payment_intent_id`, `payment_link`, `inkbox_context_id` |
| `results` | `id`, `task_id`, `claim_id`, `seller_id`, `model_id`, `result_enc_buyer`, `result_enc_judge`, `commitment_sha256`, `runtime_ms`, `tokens_out` |
| `verdicts` | `id`, `task_id`, `result_id`, `judge_id`, `verdict`, `reason_code`, `reason_public`, `score`, `replacement_enc_buyer` |
| `settlements` | `id`, `task_id` (unique), `kind` (STRIPE_TEST / MOCK), `state`, `seller_payout_cents`, `buyer_refund_cents`, `stripe_capture_id`, `stripe_transfer_id`, `note` |
| `events` | `id`, `task_id`, `agent_id`, `type`, `meta` — dashboard timeline (never plaintext) |

**Task states:** `[AWAITING_PAYMENT →] OPEN → PAYLOAD_READY → RUNNING → SUBMITTED → JUDGING → APPROVED | REJECTED`, plus `EXPIRED`, `CANCELLED` (`AWAITING_PAYMENT` during durable posting and while MPP awaits payment; `CLAIMED` exists in the enum but `claim_task` moves straight to `PAYLOAD_READY` because the envelope is produced in the same atomic update). Lease 300 s, renewable; expiry reopens the task and invalidates the seller envelope. Claim = one `UPDATE … WHERE id=? AND status='OPEN'` → exactly one winner.

## 4. Payments — Stripe test mode (`PAYMENT_MODE=card | mpp | mock`)

**`card` (GA, built, verified):** buyer registration creates a Stripe Customer with test card `pm_card_visa` and a human-set `spend_cap_cents`. `post_task` → cap check → `paymentIntents.create({ amount: max_price_cents, capture_method: 'manual', confirm: true, off_session: true, automatic_payment_methods: {enabled, allow_redirects: 'never'}, transfer_group: task_id })` → `requires_capture` (hold). APPROVE → `capture({ amount_to_capture: price_cents })` (remainder released) then `transfers.create` to the seller's connected account (currently fails: account needs onboarding → recorded `PENDING_ONBOARDING`, labelled). REJECT / EXPIRED / CANCELLED → `paymentIntents.cancel`.

**`mpp` (Stripe "Monetize your MCP server", experimental — Computer D):** `post_task` creates the task in `AWAITING_PAYMENT` and returns `payment_link = ${BASE_URL}/api/pay/<task_id>`. That Hono route runs `mppx` with `stripe.create({ client, networkId: STRIPE_PROFILE_ID, livemode: false }).spt.charge()` → first POST answers **HTTP 402 + `WWW-Authenticate: Payment …`**; the buyer agent pays with the **Link agent wallet** (`npx @stripe/link-cli --mcp` as an MCP server, `spend-request create --credential-type shared_payment_token --network-id profile_test_… --test --request-approval`, human approves on their phone, `mpp pay <link>`) → the server charges `max_price_cents` via a Shared Payment Token, task → `OPEN`. APPROVE → `refunds.create` for `max − price` + transfer; REJECT → full refund. Test without a phone: `POST /v1/test_helpers/shared_payment/granted_tokens` and `npx mppx@latest validate http://localhost:3000`.

**`mock`:** no money moves; every surface says MOCK.

Why both real modes: `mpp` is the Stripe-track showcase (agent pays for the compute it needs; human approves/limits spend), `card` is the dependable path. Settlements are idempotent (one per task). Webhooks are skipped; PaymentIntent status is polled.

## 5. The sandbox and the open blocker

The Wasm component (`packages/runner-wasm`) exports `get-public-key`, `run-task`, `judge-task` (see CONTRACT.md §6). It builds and loads under Wassette 0.8.0. **Finding (18:29 PDT):** Wassette instantiates a fresh component instance for every tool call, so module-level state does not survive between `get-public-key` and `run-task`; the second call cannot decrypt (`invalid tag`). Writing the key to disk is not possible from componentize-js (no guest filesystem API), and passing a seed from the host would let the host decrypt.

**Fix (runner-driven single call, owned by C with A):** make one component call do the whole job so the ephemeral key never leaves the instance:
- `run-cycle(opts)` inside the sandbox: generate keypair → call the marketplace `claim_task` **from inside the sandbox** (wasi:http to the marketplace host, seller API key supplied via the env grant) passing `runner_pubkey_b64` + `runner_key_id` → receive the seller envelope → decrypt → Ollama → seal to buyer + judge (keys come back in the claim response) → `submit_result` from inside the sandbox → return a summary to the host.
- `judge-cycle(opts)`: `fetch_review_package` → decrypt with the judge key (env grant) → grade (Anthropic) → `submit_verdict`, all inside the sandbox.
- Server side (A): `claim_task` accepts optional `runner_pubkey_b64` / `runner_key_id` (per-claim key overrides the registered one) and returns `buyer_public_key` + `judge_public_key` so no second round trip is needed; `register_seller` keeps the registered key optional.
- Policies: add the marketplace host to both allow-lists; add `AGENT_API_KEY` to the env grant. Keep Ollama as the only other seller host.
- Honest framing: the host supplies the seller's own API key (it is the host's identity) but never the task key; a TEE would additionally hide memory.

## 6. Identity + messaging — Inkbox (Computer E)

Server holds the org admin key (`INKBOX_API_KEY`). `register_agent` → `inkbox.createIdentity("atm-<handle>")`, `identity.a2aEnable()`; identity-scoped keys stored encrypted for daemons. Messaging: `identity.a2aClient().send(card, { text, contextId })`; workers `iterA2ATasks({ state: "submitted" })` + `a2aReply(id, { intent })`. Every task gets an Inkbox `contextId` so the buyer↔seller↔judge thread is visible in the Inkbox console during the demo. Free tier = 3 identities in one org, no contact rules needed. `apps/marketplace-mcp/src/inkbox.ts` is a no-op stub with the exact function signatures the server already calls.

## 7. Phases and ownership (remaining work)

| # | work | owner | target |
|---|---|---|---|
| 2 | Runner-driven single-call claim in the component + Wassette runtime grants; denied-host demo | C (+A for `claim_task` params) | 21:30 |
| 3 | Stripe: Accounts v2 recipient onboarding so transfers succeed; MPP mode + Link CLI showcase | D | 02:00 |
| 4 | Judge inside Wassette (`judge-cycle`), llm_rubric path, rejection → replacement answer, strikes/suspension demo | E | 01:00 |
| 5 | Inkbox identities + A2A notices; console demo | E | 03:30 |
| 6a | Dashboard `apps/web`, SKILL.md + llms.txt, Claude Code / Codex recipes, Armature eval | B | 05:00 |
| 6b | Manufact deploy, integration merges, keep `main` runnable, final rehearsal | A | 07:00 |
| 7 | Demo script (accepted, rejected, race, denied host), video, submission | E (+ everyone) | 09:00 |

## 8. Risks → fallbacks

| risk | fallback |
|---|---|
| Single-call runner takes too long | ship `--runtime node` (already works end to end, labelled UNSANDBOXED) and demo the sandbox denying a host with the current component |
| StarlingMonkey `fetch` POST to plain-http Ollama misbehaves | `jco componentize --backend qjs`; else Rust component for run-task |
| Stripe MPP/SPT preview or Link wallet verification blocks | stay on `card` mode; demo human control as the registration-time spend cap |
| Connect transfer refused for un-onboarded sandbox account | payout recorded `PENDING_ONBOARDING`, shown labelled on dashboard |
| Manufact deploy issues | demo against the local server through `mcp-use dev --tunnel` |
| Inkbox identity claim/verification delay | create the 3 identities early in the console |
| Ollama too slow live | `qwen3:4b` in the allowlist; `max_tokens` cap 300 |

## 9. Explicitly out of scope
Buyer-side E2E encryption proxy · x402 / on-chain anchoring · Primitive email channel · Blaxel cloud seller node · OCI-published runner with digest pinning · random judge sampling (demo reviews 100%).
