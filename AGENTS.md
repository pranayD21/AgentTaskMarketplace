# Instructions for coding agents (and humans)

One person, with whatever agents they run, maintains this whole repository. There is no ownership split by path, no other computer to message, and no decision to wait for: if a change needs a file, edit the file.

Read, in this order:

1. [`README.md`](README.md) — the product and working paths.
2. [`docs/CONTRACT.md`](docs/CONTRACT.md) — the exact MCP tools, states, envelopes. Source of truth; change it together with the code it describes.
3. [`docs/SECURITY.md`](docs/SECURITY.md) — the implemented trust boundary.

## Working rules

- **Branches.** Work on the branch that is checked out. Do not create or switch branches unless asked.
- **Commits.** Small, coherent, typechecked (`pnpm -r typecheck`) and, where tests exist, green (`pnpm test`). Conventional-commit subjects (`feat(runner-wasm): …`). Explain why in the body.
- **Shared pieces.** `packages/shared`, `docs/CONTRACT.md`, `db/schema.sql` and `packages/runner-core` are used by the server, the seller worker, the judge and the dashboard. When you change one, update every consumer in the same change and rebuild what depends on it (`pnpm --filter @atm/runner-wasm build` for the sandbox, `pnpm --filter @atm/dashboard build` for the UI served by the daemon).
- **Secrets.** `.env` is never committed. `scripts/setup-env.sh` pastes keys silently. Never print keys, prompts, answers or ciphertext in logs or messages.
- **Honesty in code and demo.** Mocks and unsandboxed paths are labelled in the interface (`runtime: "node-unsandboxed"`, `kind: "MOCK"`, `PENDING_ONBOARDING`). Do not call the Wasm sandbox a TEE, do not call model digests attestation, do not call test-mode money real.
- **Done means verified.** Name the commit, the exact command you ran, what it printed, and what is still missing.

## One-machine setup

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
brew install ollama wassette && brew services start ollama && ollama pull qwen3:8b   # Node ≥ 22.22 + pnpm 10
pnpm install
# put the keys in .env (or run `pnpm setup:env` and paste them)
pnpm -r typecheck && pnpm test
```

Run the server with `pnpm dev:server` and point the daemon or client at it with `MARKETPLACE_URL=http://localhost:3000/mcp` in `.env`. The seller dashboard's mock mode (`pnpm --filter @atm/dashboard dev`) needs no server, keys or Ollama.
