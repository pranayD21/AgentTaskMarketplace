# Computer E — judge in the sandbox, Inkbox identities + A2A, demo script

## Current handoff (2026-10-17, 19:47 PDT)

The judge-cycle and Inkbox implementation are merged. Live Wassette approval is verified on the hosted server, and denial of marketplace access was rechecked. Your 02:45 UTC acknowledgement says final demo updates and the notice check with existing identities await your human’s go. Hand those results to C when ready; preserve shared Inkbox identities.

Shared MCP endpoint: `https://warm-cloud-4hh5i.run.mcp-use.com/mcp`. Application health: `https://warm-cloud-4hh5i.run.mcp-use.com/api/health`. Public dashboard on C’s LAN: `http://192.168.4.163:5173`. Set `MARKETPLACE_URL` to the hosted endpoint in your private environment. Local agents need `--poll-ms 5000`. All payments are Stripe TEST mode.

Latest completed checks: 79 tests, workspace typecheck and smoke passed; the real-Wassette daemon suite passed 7/7. The accepted Armature run passed 5/5. Read your four incoming coordination files before starting; the original implementation checklist below records the build assignment and may describe work that is already complete. Deployment details are in `docs/DEPLOYMENT.md`; evidence is in `docs/PROGRESS.md` and `docs/ARMATURE-RESULTS.md`.

You are **E**. You own `apps/marketplace-mcp/src/inkbox.ts`, the judge path in `packages/runner-core` and `apps/agent-daemon` (judge loop; coordinate with C who owns the runtimes and the component), and `demo/**`. Targets: Inkbox track, the "judge in a confidential sandbox" claim, and the live demo itself.

## 0. Setup (15 min)

```sh
git clone git@github.com:pranayD21/AgentTaskMarketplace.git && cd AgentTaskMarketplace
git switch -c feat/e-judge-inkbox origin/main
brew install ollama wassette && brew services start ollama && ollama pull qwen3:8b   # to run a seller locally while testing the judge
pnpm install && pnpm -r typecheck && pnpm build:runner
# .env from the human: MARKETPLACE_URL, JUDGE_PRIVATE_KEY_B64, JUDGE_REGISTRATION_SECRET, ANTHROPIC_API_KEY, INKBOX_API_KEY (+ server keys if you run your own server).
pnpm daemon --role judge --runtime node --once      # works today; approves/rejects whatever is SUBMITTED
```

Read `docs/PROGRESS.md` §3 (runner-core judge path, inkbox.ts stub, daemon judge loop), §6 issues 1 and 3; `docs/CONTRACT.md` §3 judge tools and §7; `docs/SECURITY.md`; `docs/PLAN.md` §6.

## 1. Judge inside Wassette — target 01:00 (after C's `run-cycle` pattern, ~21:30)

Same per-call-instance problem as the seller: the judge key is fine (it comes from env each call) but a round trip through the host is unnecessary and the claim of "judge in a sandbox" should mean the verdict is produced and submitted inside the component.
1. Add `export judge-cycle: func(opts: string) -> result<string, string>;` to `wit/world.wit` (coordinate with C: you both edit the component; agree in `E-to-C`/`C-to-E` who commits the WIT change, or have C land `run-cycle` first and rebase). `opts`: `{ marketplace_url, judge_model? }`.
2. Implement `judgeCycle` in `packages/runner-core`: read `AGENT_API_KEY`, `JUDGE_PRIVATE_KEY_B64`, `ANTHROPIC_API_KEY` from `wasi:config`; call `fetch_review_package` over MCP-via-fetch (reuse C's helper); `judgeTask`; `submit_verdict`; return `{ task_id, result_id, verdict, reason_code }` or `{ idle: true }`.
3. Grants: judge network = marketplace host + `api.anthropic.com`; env = `AGENT_API_KEY`, `ANTHROPIC_API_KEY`, `JUDGE_PRIVATE_KEY_B64`. Update `policies/judge.policy.yaml` and `GRANTS.judge` in `apps/agent-daemon/src/runtime/wassette.ts` (C owns the file; send the diff in `E-to-C` or agree that you commit it).
4. Daemon judge loop in wassette mode: call `judge-cycle` every `--poll-ms`.

## 2. Verdict quality and the rejection path — target 00:00 (can start now, node runtime)

- `llm_rubric`: post a task with `--criteria "The answer lists exactly three prime numbers under 20"`; confirm `LLM_RUBRIC_PASS/FAIL`, `score`, and that `reason_public` never quotes task text. Default model `claude-opus-5-5`, `effort: low` (`packages/runner-core`); set `JUDGE_MODEL` if latency is a problem.
- Rejection demo: a `contains_text` task the small model will miss (e.g. expect a deliberately wrong token) → REJECT → `replacement_enc_buyer` present → `node scripts/buyer.mjs result <id>` shows `replacement_answer`; seller `strikes: 1`, `status: SUSPENDED` (`SUSPEND_AFTER_STRIKES=1`), and the next `claim_task` from that seller fails with `SELLER_SUSPENDED`. Stripe hold cancelled.
- Idempotency: call `submit_verdict` twice → second returns `idempotent: true`.

## 3. Inkbox — target 03:30

Implement `apps/marketplace-mcp/src/inkbox.ts` (same exported shape; the service already calls `createIdentity` at registration and `notify` on claim/submit/verdict):
- `new Inkbox({ apiKey })` (`@inkbox/sdk` 0.7.19 is installed). `createIdentity(handle, displayName)` → `inkbox.createIdentity(handle, { displayName })`, then `identity.a2aEnable()`, `identity.a2aSetSkills([...])`; return `{ handle, identity_id, card_url }`. Handles must be globally unique: prefix with the org, e.g. `atm-<agent_id suffix>`. Free tier = 3 identities: buyer, seller, judge for the demo; handle exhaustion → return null and log once.
- `notify({ type, task_id, to_handle, text, context_id })`: send an A2A message from the marketplace's own identity (create `atm-marketplace` once, cache its `a2aClient()`) to the target card `https://inkbox.ai/a2a/<handle>/card`, reusing `context_id` per task so the thread is one context; return the `contextId`. Fire-and-forget with a 5 s timeout; never fail a tool because Inkbox is slow.
- Optional: daemon as A2A worker — poll `identity.iterA2ATasks({ state: "submitted" })` and `a2aReply(..., { intent: "complete" })` so the Inkbox console shows two-way traffic; `ask_caller` → buyer `answer_question` is a stretch (needs a new tool from A).
- Verify in the Inkbox console: three identities, one context per task with assignment → submitted → verdict messages. Screenshot for the submission.

## 4. Demo script — target 05:00, rehearse 07:00 with A

`demo/README.md` + `demo/run.sh`: numbered steps with exact commands and what the audience should see, under 3 minutes:
1. Dashboard open (B) + Stripe test dashboard + Inkbox console tabs.
2. Claude Code (buyer) calls `marketplace_info`, posts a task (hold appears in Stripe).
3. Seller daemon (Wassette) claims and runs; show the allow-list line and Ollama working; show the denied-host log (C).
4. Judge daemon (Wassette) approves; Stripe capture; buyer reads the answer with `commitment_verified: true`.
5. Rejection path pre-recorded or live: REJECT, suspension, replacement answer, hold cancelled.
6. One slide of honesty: sandbox not TEE, test mode, self-reported models.
Include a fallback plan (node runtime) and the hosted Manufact URL (A). Record the 2–3 minute video with B.

## Verify and hand off

- Judge runs inside Wassette end to end (or clearly documented fallback), rejection path reproducible, Inkbox thread visible.
- `HANDOFF` to A for each slice (branch, commit, commands, outputs, files touched outside your ownership if any); `HANDOFF` to C for component/daemon edits.
