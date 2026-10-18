# Computer B — buyer experience, agent-facing docs (AX), dashboard

## Completion audit: your next assignment (2026-10-17, 20:05 PDT)

The core marketplace is running, but the full original request is unfinished. This section takes priority over the historical build checklist below. The [completion audit](../docs/COMPLETION-AUDIT.md) gives evidence, assignment IDs and acceptance criteria. Fresh checks on `82d0aa2` passed workspace typecheck, 79 tests and smoke. Earlier real-Wassette and hosted purchase evidence remains valid. No cost benchmark or complete multi-computer job demonstration has been recorded.

Start by fetching the latest `origin/main` and bringing it into your existing feature branch without discarding local work. Read your four inbound files in `coordination/messages/`, then acknowledge this assignment to C in `<YOUR LETTER>-to-C.md` (C records its own progress in its outbound handoffs). C remains acting integrator under A's delegation. Send contract/schema requests to A; C coordinates merges. Do not edit another computer's implementation files without a recorded ownership decision.

Use `MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp` in your private environment. Application health is `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`; dashboard is `http://192.168.4.163:5173/` on C's LAN. Workers use `--poll-ms 5000`. Preserve the running service and existing identities. Do not reset shared Inkbox identities. The Armature buyer has 25 cents available, below the 50-cent new-task minimum; a new buyer or higher cap must not be used to bypass that limit. All current payment evidence is Stripe TEST mode.

### Your work, in order

1. **J1/J3/P2, support:** after A/E publish the contract, check that private synthetic text never appears in the public dashboard/API, replacement status is truthful, and pending seller transfers are not labelled paid. You own the UI; A/E/D own the underlying fixes.
2. **F1, lead:** implement buyer-side splitting of one instruction into useful bounded parts, durable tracking/resume without duplicate purchases, commitment checks and aggregation of verified results. Add a dashboard grouping parts under a safe parent ID with assigned computer/seller and progress. Ask A for the shared contract first. Acceptance: at least two useful parts, partial failures visible, no duplicate purchases after restart, and total authorized budget respected.
3. **V1, lead:** finish pending-seller and rejected-result Armature cases when authorized fixtures exist. Coordinate rejection with E and fixture/budget needs with A/D. Build a local controlled disconnect after server acceptance and prove recovery without reposting. Keep the current missing-ID recovery labelled simulated. Your documentation update and interrupted-response guidance fix are already handed off in PR #3 (`39eaa4e`); C now owns their review/integration. Extend `docs/buyer/evaluation.md` and `verification.md` when new evidence exists, rather than redoing that completed branch work.
4. **B1, lead:** write `docs/buyer/benchmark-plan.md`, implement the harness in newly assigned `scripts/benchmarks/**`, and save redacted runs/report under `docs/buyer/**`. Specify exact versioned workloads, commands, model versions, sample counts and one closed-source baseline. Compare identical cases on direct local inference, the marketplace and the baseline. Measure quality/success, p50/p95 latency, throughput and retries. D supplies the cost ledger, C seller metrics, E judge/replacement usage, A hosting/schema. Use current official pricing sources and an authorized external-call budget. No cost-savings claim is supported yet.
5. **L1/D1:** operate the buyer and dashboard for C's physical-computer rehearsal. Post one bounded job only when fixtures/budget are ready. Capture two different physical sellers working on its parts and the verified combined result.

### Finish and hand off

Use your existing B feature branch based on current `main`. Own `apps/web/**`, `skills/**`, `scripts/buyer.mjs`, `docs/buyer/**`, and now `scripts/benchmarks/**`; A owns root package scripts and shared schema. Send C assignment IDs, branch/SHA, commands/results, fixture limits and redacted evidence. Coordinate any seller/judge source change with C/E. Do not export raw Armature traces containing its disposable credential.

## Historical handoff (2026-10-17, 19:58 PDT)

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
