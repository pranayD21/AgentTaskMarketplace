# Computer B — buyer experience, agent-facing docs (AX), dashboard

## Current handoff (2026-10-17, 19:58 PDT)

The dashboard, buyer kit, hosted connection recipes and accepted-case evidence are merged through your handoff `22c771f` / PR #2 (`a0b4c37` on main). Armature’s accepted-task case passed through the hosted endpoint; use docs/ARMATURE-RESULTS.md for evidence. C has now completed cap rejection and simulated recovery too. Pending-seller and rejected-result scenarios lack fixtures within the remaining cap. Incorporate the updated redacted report into docs/buyer when you next work there.

Shared MCP endpoint: `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`. Application health: `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`. Public dashboard on C’s LAN: `http://192.168.4.163:5173`. Set `MARKETPLACE_URL` to the hosted endpoint in your private environment. Local agents need `--poll-ms 5000`. All payments are Stripe TEST mode.

Latest completed checks: 79 tests, workspace typecheck and smoke passed; the real-Wassette daemon suite passed 7/7. Three Armature cases passed 5/5 each: accepted purchase, cap rejection and simulated task-ID recovery. Pending-seller and rejected-result cases lack fixtures within the remaining 25-cent cap; see the report for the exact limits. Read your four incoming coordination files before starting; the original implementation checklist below records the build assignment and may describe work that is already complete. Deployment details are in `docs/DEPLOYMENT.md`; evidence is in `docs/PROGRESS.md` and `docs/ARMATURE-RESULTS.md`.

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
