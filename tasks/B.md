# Computer B — buyer experience, agent-facing docs (AX), dashboard

You are **B**. You own `apps/web/**`, `skills/**`, `scripts/buyer.mjs`, and `docs/buyer/**`. Your users are agents (Claude Code, Codex) and the humans watching the demo. Targets: Manufact "Best MCP Server for Agents" and Armature "Best Agent Experience".

## 0. Setup (10 min)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
git switch -c feat/b-buyer origin/main
pnpm install && pnpm -r typecheck
# .env from the human. For B only MARKETPLACE_URL matters (A posts it in A-to-B); you do not need Stripe/Insforge keys unless you run your own server.
node scripts/buyer.mjs whoami                     # registers a buyer on first run (.atm-state/buyer.json)
```

Read `README.md`, `docs/CONTRACT.md` (tools, errors, states), `docs/SECURITY.md`, `coordination/README.md`. You do not need Ollama or Wassette.

## 1. Real buyer agent end to end — target 20:00

1. `claude mcp add --transport http atm <MARKETPLACE_URL> --header "Authorization: Bearer <api_key from .atm-state/buyer.json>"`.
2. In Claude Code, ask it to delegate a small task (e.g. "Use the atm marketplace to get a one-word answer for the capital of Japan; grade with contains_text Tokyo; max 100 cents; then fetch the result"). Record every friction point: which tool it tried first, whether `marketplace_info` was enough, which error messages confused it.
3. Same with Codex: `codex mcp add atm --url <MARKETPLACE_URL> --bearer-token-env-var ATM_API_KEY` (check `codex mcp add --help` for the exact flag) and repeat.
4. Send A a `QUESTION`/`HANDOFF` with concrete wording changes for tool descriptions and `next_action` strings (A owns `tools.ts`). Keep the list short and specific.

## 2. `skills/marketplace/` — target 22:00

- `SKILL.md` (Claude Code / Codex skill format: frontmatter `name`, `description`, then instructions): when to use the marketplace, the exact buy sequence (`register_agent` once → `post_task` → poll `get_task` → `get_result`), how to pick `allowed_models` and `max_price_cents`, how to write a `contains_text` vs `llm_rubric`, how to handle `SPEND_CAP_EXCEEDED` / `REJECTED` (use `replacement_answer` or re-post), and the seller sequence for completeness.
- `llms.txt` at repo root: one-page agent-readable overview with the hosted URL placeholder, tool list, auth, and links.
- `docs/buyer/claude-code.md` and `docs/buyer/codex.md`: copy-paste connection recipes, including the hosted Manufact URL once A posts it.

## 3. Dashboard `apps/web` — target 02:00

Vite + React + TypeScript, reading `GET <BASE_URL>/api/dashboard` every 3 s (CORS is enabled). Show, labelled:
- Counts by state; task board (task_id, status, allowed models, max price, claimed price, seller, lease countdown, payment state, Stripe PaymentIntent id as a link to `https://dashboard.stripe.com/test/payments/<pi>`).
- Sellers: display name, models + asks, runtime badge (**`wassette`** green / **`node-unsandboxed`** red with the word UNSANDBOXED), runner key id, wasm sha256 prefix, approvals/rejections/strikes, status.
- Verdicts and settlements (payout/refund, `STRIPE_TEST` label, `PENDING_ONBOARDING` note).
- Event timeline (type + task id + time). Never render anything that could be a prompt (the API does not send any; keep it that way).
- A "what you are looking at" panel quoting `docs/SECURITY.md` → sandboxed, not a TEE; test mode.

Scripts: `pnpm --filter @atm/web dev` (port 5173), `build`. Add the package to the workspace (`apps/*` is already included). Ask A to add `"dev:web"` to the root scripts if you want it there (A owns root `package.json`).

## 4. Armature — target 04:00

Register the hosted MCP URL with Armature (human account), run their agent-experience eval, and send A the top findings as concrete description/`next_action` edits. Keep screenshots for the submission.

## Verify and hand off

- A Claude Code session that posts a task and reads the result with no human help beyond the API key.
- `pnpm --filter @atm/web build` passes; the dashboard shows a live run from A's server.
- `HANDOFF` to A: branch, commit, commands, screenshots path, remaining gaps. `HANDOFF` to E with the dashboard URL and the buyer recipes for the demo script.
