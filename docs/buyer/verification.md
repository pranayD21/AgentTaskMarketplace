# Computer B verification — 2026-10-18 UTC

Branch: `feat/b-buyer`, based on `19f7431` (current TypeScript v0.2 plan). This records completed checks separately from the remaining Armature dependency. No private responses, credentials, or ciphertext are included.

## Local checks

| Command / check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass with the generated web dependency lockfile update. |
| `pnpm -r typecheck` | All seven workspace packages pass. |
| `pnpm --filter @atm/web build` | Pass; Vite production bundle generated. |
| `pnpm --filter @atm/web test` | 12 tests pass: public rendering, payment/runtime labels, filtering, links/leases, MCP response handling, input validation, endpoint-bound identity, commitment failure handling. |
| `pnpm --filter @atm/crypto test` | Existing six crypto tests pass. |
| `pnpm test` at baseline | Fails because `apps/marketplace-mcp` declares `vitest run` but has no test files. Reported to A; B did not modify the server's test script. |
| Skill creator `quick_validate.py skills/marketplace` | Pass. PyYAML installed in an ignored local validation environment. |
| `node scripts/buyer.mjs whoami` | Registers once, privately stores the key, then reuses the buyer. |
| `node scripts/buyer.mjs wait task_0406a62309ba9383 --timeout 1` | APPROVED, commitment verified, CAPTURED; redundant ciphertext absent from CLI result. |
| Buyer post with 2,001-cent budget on a 2,000-cent-cap buyer | `SPEND_CAP_EXCEEDED`, nonretryable; no extra task or hold created. |

Toolchain: Node 22.23.2, pnpm 10.33.2, Claude Code 2.1.302, Codex CLI 0.155.0-alpha.16. CLI help was checked for the documented MCP flags.

## Actual buyer agents

Both harnesses used the same saved buyer identity over Streamable HTTP at `http://localhost:3002/mcp`, served from A's marketplace implementation against the shared Insforge/Stripe test configuration. Port 3000 was already occupied. The shared seller `computer-c-wasm-check` claimed both tasks; its advertised runtime was `wassette` (self-reported, not attestation). No local inference or simulated answer was substituted.

| Harness | Task | Observed outcome |
| --- | --- | --- |
| Claude Code | `task_0406a62309ba9383` | First call `marketplace_info`, then `list_sellers`, `whoami`, one `post_task`, ten `get_task`, `get_result`. Initially SUBMITTED with a verified result; a subsequent read-only Claude call confirmed APPROVED. |
| Codex | `task_e590ef03e793d493` | First tool started was `list_sellers`, with `marketplace_info` also called. One post, polling, then `get_result` returned APPROVED and `commitment_verified=true`. Raw event start/completion pairs are not separate purchases. |

For each, the expected synthetic answer matched, the verdict was APPROVE, the payment was CAPTURED, and STRIPE_TEST settlement recorded a 75-cent seller payout and 25-cent buyer refund from the 100-cent hold. Raw answers were checked in memory and excluded from this report. The read-only follow-up for Claude finished at 02:01:40Z. The first run stopped polling before the judge finished; it must not be described as a single-session approval wait success.

Evaluations used isolated MCP configuration, a maximum $1 Claude API budget per invocation, and at most one marketplace post per harness. The Codex evaluation was ephemeral. Only redacted event summaries were saved under `.atm-state/`; no provider keys were put into persistent agent configuration.

## Browser and privacy checks

- Browser loaded live `GET /api/dashboard`, without a buyer credential. A recursive inspection of the actual response found no prompt, context, rubric, answer, API key, task envelope, result envelope, or server plaintext fields. This is evidence for the observed response, not a guarantee about arbitrary future event metadata.
- Render tests inject private markers into task fields, event metadata, verdict free text, settlement notes, and unknown event types. No marker reaches rendered HTML; pending onboarding is reduced to a boolean.
- Checked desktop width 1280 and mobile width 390. At mobile width the document width remained 390; the task table scrolls within its panel. State selection produced only REJECTED rows; search showed a distinct no-match state and clearing it restored rows.
- Stopped only B's local server to test an outage. The browser retained 19 task rows and displayed “Showing the last successful snapshot”; restarting the server cleared the alert automatically.
- Screenshots are local, ignored runtime artifacts under `.atm-state/screenshots/`: `dashboard-desktop.png`, `dashboard-overview.png`, `dashboard-mobile.png`, `dashboard-stale.png`. They show public metadata only. They are intentionally not committed.

## Findings sent to A

1. `marketplace_info` should recommend `list_sellers` and `whoami` before posting, and give a three-second polling interval plus a bounded stop condition. The Claude run exhausted ten rapid polls before review completed.
2. `get_result` can return a verified result at SUBMITTED, while onboarding text says “once APPROVED.” Distinguish integrity verification from the judge's decision; explain when to continue polling.
3. Onboarding privacy text should explicitly say the operator receives plaintext at posting and holds buyer keys. The Wasm boundary does not hide plaintext from the seller's OS/Ollama.
4. `SPEND_CAP_EXCEEDED.next_action` suggests a new buyer with a larger cap. Prefer checking `whoami`, reducing the budget, or cancelling unwanted OPEN holds; a new identity should not be the default recovery.

## Still pending

The human asked B to contact A and wait for A to arrange Armature account access and the hosted endpoint. B posted the blocker to `B-to-A.md` on main. Armature currently presents a sign-in page; no hosted Manufact MCP URL has been announced in `A-to-B.md`. The prepared [evaluation cases](evaluation.md) are not a completed Armature evaluation. The docs deliberately use a labeled placeholder until A supplies the real URL. A owns integration/merge and any shared tool wording changes.
