# Computer B verification — 2026-10-18 UTC

Branch: `feat/b-buyer`, initially based on `19f7431`; merged main through `700f952` in merge commit `961dc8a`, then incorporated C's integration through `c215b89` and deployment preparation through `8ace6e6`. This records completed checks separately from the remaining Armature dependency. No private responses, credentials, or ciphertext are included.

## Local checks

| Command / check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass with the generated web dependency lockfile update. |
| `pnpm -r typecheck` | All seven workspace packages pass. |
| `pnpm --filter @atm/web build` | Pass; Vite production bundle generated. |
| `pnpm --filter @atm/web test` | 14 tests pass (latest run after v0.2 / MPP integration): public rendering, payment/runtime labels, filtering, links/leases, MCP response handling, input validation, endpoint-bound identity, commitment failure handling, and unfamiliar settlement rail fallback. |
| Crypto tests | Initially six passed; seven pass in the merged workspace suite. |
| `pnpm test` after merging C's integration | Pass: 76 tests — web 14, crypto 7, runner-core 19, agent-daemon 6 (+1 Wassette test skipped), marketplace server 30. The original missing-server-tests failure is resolved. |
| `pnpm smoke` on main `8ace6e6`, 02:40Z | Pass: registered-key and per-claim flows both APPROVED with verified commitments; MEMORY storage, MOCK settlement, no external model or payment calls. |
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

B's local evaluation launcher now records numeric provider-reported cost and token usage when present, for future authorized evaluations. Earlier summaries omitted those fields; their exact billed model cost cannot be reconstructed from the saved evidence. No new model API run was made for this change.

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

## Contract v0.2 integration and C's LAN server

At 02:27Z B verified `curl --silent --show-error --connect-timeout 3 --max-time 8 http://192.168.4.163:3000/health`: HTTP 200, contract `0.2`, `Insforge Postgres`, payment mode `card`. `MARKETPLACE_URL=http://192.168.4.163:3000/mcp node scripts/buyer.mjs info` successfully completed MCP discovery and reported the same contract, storage, and payment mode. These were discovery checks, with no new buyer registration or purchase. C's reply is `C-B-20261018T022341Z-01` on main.

The dashboard now reads C's server from B's ignored `apps/web/.env.local`. Browser verification showed a live refresh, the new `computer-c-v02` seller with a latest-claim key, and 25 task rows. Screenshot: `.atm-state/screenshots/dashboard-v02-c-server.png`. Fixtures now include the required v0.2 `runner.key_source`. MEMORY storage displays an explicit temporary-development-data notice.

D's parallel testing added settlement kind `MPP` to the shared database before its contract was merged. That caused the previous strict settlement-kind parser to reject an otherwise valid dashboard snapshot. The parser now maps unfamiliar kinds to a fixed `UNRECOGNIZED PAYMENT RAIL` label and keeps the board available without rendering arbitrary text. A render regression test covers it; C subsequently merged the MPP contract in `b1f8c09`; B preserved its exact MPP / STRIPE_TEST labels and `task.paid` event support, added PAID emphasis, and documented the wallet sequence. The unknown-kind fallback remains for future rails. Card/STRIPE_TEST and MOCK labels remain explicit.

`pnpm smoke` was attempted twice here. The first invocation exited without a successful health summary; the diagnostic retry reached contract 0.2 / MEMORY / mock discovery but failed with `seller daemon timed out`. No Stripe purchases or external model calls were made by this offline smoke harness. This is a local failed check, not a passing integration result; C/A need to assess it alongside their own smoke evidence. C independently reports a passing smoke run on integrated main `b1f8c09` in `C-B-20261018T022940Z-01`. These historical failed attempts remain recorded.

After refreshing to main `8ace6e6`, B reran `pnpm install --frozen-lockfile` and `pnpm smoke` at 02:40Z. Both registered-key and per-claim paths returned APPROVED with `commitment_verified=true`; invalid or missing runner keys returned the expected errors. Final output: `smoke passed — buyer spend: reserved 0c, spent 135c of 1000c (MOCK)`, exit 0. The earlier timeout did not recur; its exact cause was not established. This offline smoke uses a fake Ollama response and proves integration plumbing, not model quality, sandbox isolation, or Stripe payments.

A accepted B's four wording findings and merged them in `69b8e88` / `bc05530`; the pending wording requests above are resolved. A approved B's generated lockfile and delegated live integration/deployment to C in `A-B-20261018T021200Z-01` and `A-C-20261018T021200Z-02`.

## Hosted endpoint verification — 02:43Z

C published [https://warm-cloud-4hh5i.run.mcp-use.com/mcp](https://warm-cloud-4hh5i.run.mcp-use.com/mcp) in `C-B-20261018T023856Z-01`. From B, `MARKETPLACE_URL=https://warm-cloud-4hh5i.run.mcp-use.com/mcp node scripts/buyer.mjs info` returned contract 0.2, Insforge Postgres, and card mode. `node scripts/buyer.mjs tools` at the same endpoint listed 21 tools. The hosted `/health` is the framework's response; application configuration is verified through `marketplace_info`.

Using the existing buyer credential in private process configuration, `node scripts/buyer.mjs task task_0406a62309ba9383` returned APPROVED / CAPTURED / STRIPE_TEST. `node scripts/buyer.mjs result task_e590ef03e793d493` returned APPROVED / CAPTURED / STRIPE_TEST with `commitment_verified=true`. The result was parsed in memory and its private answer/ciphertext were excluded from the report. No task was posted and no model provider was called by these checks. After confirming the same shared marketplace, B migrated its ignored local buyer cache to the hosted endpoint and `whoami` reused that buyer with 0 cents reserved, 150 spent, and 1850 available of its existing 2000-test-cent cap.

The browser dashboard now reads the hosted API; it displays live metadata, both test payment rails, and latest-claim key labels. Public screenshot: `.atm-state/screenshots/dashboard-hosted-overview.png`. Connection recipes and `llms.txt` now contain the working hosted URL; `.env.example` points the web app at it. B's PR #1 was merged at `24c7c86`; this hosted documentation is a follow-up.

## Still pending

C has usable team Armature access and reports successful discovery of all 21 hosted tools. The actual evaluation outcomes and redacted evidence have not yet been handed to B. B is waiting for C's run, then will verify and incorporate the case results instead of repeating purchases. The prepared [evaluation cases](evaluation.md) remain pending until that evidence exists. A human Link-wallet evaluation is also unverified; the wallet recipe describes the integrated test-mode flow without claiming that it was exercised by B.
