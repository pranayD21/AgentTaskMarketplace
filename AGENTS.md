# Instructions for coding agents (and humans) on each computer

You are one of five computers, **A, B, C, D or E**. Your human tells you your letter. Read, in this order:

1. [`README.md`](README.md) — what the product is and what already works.
2. [`docs/PROGRESS.md`](docs/PROGRESS.md) — what has been built and verified, and the open blocker.
3. [`docs/CONTRACT.md`](docs/CONTRACT.md) — the exact MCP tools, states, envelopes. Source of truth.
4. [`docs/PLAN.md`](docs/PLAN.md) and [`docs/SECURITY.md`](docs/SECURITY.md).
5. [`coordination/README.md`](coordination/README.md) — how the five computers talk.
6. **Your brief: `tasks/<LETTER>.md`.** It is complete: setup, what to build, how to verify, what to hand off.

## Ownership

| computer | owns (edit only these paths) | branch |
|---|---|---|
| **A** | `apps/marketplace-mcp/**` (except `src/payments.ts`, `src/mpp*.ts`, `src/inkbox.ts`), `packages/shared/**`, `packages/crypto/**`, `docs/**`, `scripts/**`, root config, `tasks/**`, `README.md`, `AGENTS.md`; **merges everything into `main`**; Manufact deployment | `main` (+ `feat/a-*` for larger changes) |
| **B** | `apps/web/**`, `skills/**`, `scripts/buyer.mjs`, buyer-agent recipes under `docs/buyer/**` | `feat/b-buyer` |
| **C** | `packages/runner-wasm/**`, `packages/runner-core/**` (seller path), `apps/agent-daemon/**` (seller loop, runtimes) | `feat/c-seller` |
| **D** | `apps/marketplace-mcp/src/payments.ts`, `apps/marketplace-mcp/src/mpp*.ts`, `docs/payments/**` | `feat/d-payments` |
| **E** | `apps/marketplace-mcp/src/inkbox.ts`, judge path in `packages/runner-core` and `apps/agent-daemon` (judge loop), `demo/**` | `feat/e-judge-inkbox` |

Shared files (`packages/shared`, `docs/CONTRACT.md`, `db/schema.sql`) change only through A: write your proposal in `coordination/messages/<YOU>-to-A.md`, wait for A's `DECISION` in `A-to-<YOU>.md`, then build against it. If a file you must touch belongs to someone else, message its owner instead of editing it.

## Working rules

- **Branches.** Everyone starts from the current `origin/main` (commit "docs: document progress, plan and five-computer split" or later). Create your branch with `git switch -c <branch> origin/main`. Ignore the old `work/*` and `coordination` branches on origin; they hold the superseded Python plan and A will delete them.
- **Commits.** Small, coherent, typechecked (`pnpm -r typecheck`) and, where tests exist, green (`pnpm test`). Conventional-commit subjects (`feat(runner-wasm): …`). Push your branch often; A merges tested slices into `main` and tells everyone.
- **Messages go on `main`.** The 20 files in `coordination/messages/` are committed directly to `main` (`git pull --rebase origin main && git push origin HEAD:main`). Only the sender edits a file. Format and cadence are in `coordination/README.md`. Check your four inbound files when you start, every 10 minutes, and before any handoff.
- **Secrets.** `.env` is shared out of band by the human (never committed). `scripts/setup-env.sh` pastes keys silently. Never print keys, prompts, answers or ciphertext in logs or messages.
- **Honesty in code and demo.** Mocks and unsandboxed paths are labelled in the interface (`runtime: "node-unsandboxed"`, `kind: "MOCK"`, `PENDING_ONBOARDING`). Do not call the Wasm sandbox a TEE, do not call model digests attestation, do not call test-mode money real.
- **Done means verified.** A handoff names the branch, commit, the exact command you ran, what it printed, and what is still missing.
- **Time.** Submissions and live demos are at **10:00 AM PDT Oct 18**. Each brief has target times. If you are more than an hour behind, post a `BLOCKER` to A and propose what to cut.

## One-machine setup (every computer)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
brew install ollama wassette && brew services start ollama && ollama pull qwen3:8b   # C and E need Ollama; everyone needs Node ≥ 22.22 + pnpm 10
pnpm install
# get .env from the human (or run `pnpm setup:env` and paste the keys they give you)
pnpm -r typecheck && pnpm test
```

Point your daemon or client at the shared server. During development A runs the server on A's machine; set `MARKETPLACE_URL=http://<A's LAN IP>:3000/mcp` in your `.env` (A posts the address in `A-to-*`), or run your own `pnpm dev:server` against the same Insforge project.
