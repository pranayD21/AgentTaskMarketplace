# Computer B verification — 2026-10-18 UTC

## First hosted rollout and runner-setup correction — 05:43 UTC

B independently reached `https://warm-cloud-4hh5i.run.mcp-use.com/marketplace/` on source `0a15c4a`: health, HTML and both assets returned 200, the missing trailing slash redirected with 308, the public API contained no private task fields, and `/api/buyer` returned 404. However, the browser could not display live data. Two newly enrolled sellers had the documented `key_source: none` / empty-public-key sentinel, which the shared key validator rejected. The initial rollout is therefore **not** recorded as a fully working dashboard; see [redacted observation](runs/hosted-board.json).

B's display projection now accepts only that explicit no-key sentinel, strips it to null, and labels the seller “Awaiting runner setup” / “Not registered,” with an empty-model message. Registered and per-claim keys still require valid key descriptors. The corrected parser successfully read the actual hosted response (one task, four sellers, two awaiting runner setup). A regression covers mixed ready/pending sellers, private-field stripping, and malformed advertised-key rejection. Workspace typecheck, 239 tests (two optional Wassette skips), hosted build and `git diff --check` passed. C owns the shared schema correction and deployment; a fresh live-browser check is still required after this fix is published. No hosted task or provider call was created.

## Hosted public board preparation

C approved `/marketplace/` in `C-B-20261018T053004Z-01`. `pnpm --filter @atm/web build:hosted` now builds assets for that path and uses the browser's current origin for the public dashboard/MCP API, ignoring local API overrides. It renders an explicit hosted buyer-access notice without connection or submission controls. The local bridge is not registered in hosted development/preview mode; default local mode remains supported. Hosted buyer authentication and spending authorization are still pending the human's access-scope choice.

Validation: `pnpm -r typecheck`, `pnpm test` (237 passed, two optional Wassette skips), `pnpm --filter @atm/web build:hosted` and `git diff --check` passed. A hosted preview at `127.0.0.1:5184/marketplace/` returned both versioned assets with HTTP 200; POSTs to `/api/buyer` and `/marketplace/api/buyer` returned 404, and neither GET exposed a session token. The existing local server still returned its session nonce to a same-origin request. Browser inspection showed the hosted access notice and no local connection control. This standalone preview has no same-origin marketplace API, so live data was unavailable as expected; C must verify live data after publishing the assets. The generated assets passed a credential scan. No purchase, model call, account or budget change was made.

## Buyer form simplification — 05:16 UTC

At the human's request, the seller runtime selector and review text were removed. New form submissions omit `max_runtime_s`, so the marketplace applies its existing default. The bridge accepts the omitted field and still preserves previously saved drafts for exact-request recovery. Browser inspection confirmed the runtime field is absent while output tokens and listing expiry remain. `pnpm -r typecheck`, `pnpm test` (210 passed, two optional Wassette skips), `pnpm --filter @atm/web build` and `git diff --check` passed. The existing buyer-bridge tests now exercise specifications without a runtime field. No hosted task was posted for this edit.

## Human buyer form and demo reset — 04:44 UTC

The new local `#buyer` workspace connects the existing buyer, previews model-compatible seller registrations, accepts task/context/model/offer/output/runtime/deadline/contains-text specifications, saves a private review draft, posts with a durable request ID, and tracks private results separately from the public board. The local bridge retains the key server-side, checks loopback/origin/session boundaries, preserves the shared $5 API ledger, and reserves $2.20 before a first post. Unknown outcomes retain both the request and allowance. Submitted requests cannot be discarded as drafts; a deterministic approved result is shown only after commitment verification.

`pnpm exec tsx apps/web/server/smoke.mjs` passed at 04:44:00Z with the actual MCP server and runner crypto: one task after repeated submit, result hidden while SUBMITTED, APPROVED with commitment verification, 100 MOCK cents spent, zero reserved, and zero model API calls. This used MEMORY storage and a deterministic synthetic model on the labelled node-unsandboxed test path, not a new hosted model-quality run. See [redacted evidence](runs/web-buyer-smoke.json).

Browser checks connected the original hosted buyer and displayed compatible sellers. Preparing/reviewing a synthetic draft created no hosted task or charge. Changing the allowed model from qwen3:8b to qwen3:14b changed the candidate list from two registered sellers to none; restoring it restored those candidates. The unused synthetic draft was discarded. A direct request to Vite's file-serving route for the local identity returned HTTP 403. Workspace typecheck, 209 tests (two optional Wassette tests skipped) and web build passed before the final draft-discard regression; the final web suite passed 28/28 and the final web typecheck/build passed.

E reported a **human-requested shared database reset** in E-B-20261018T044037Z-01: tasks/results/verdicts/settlements/events/jobs cleared, buyer spent/reserved values zeroed, identities and caps preserved. B observed the existing buyer at cap 2000, spent/reserved 0, available 2000, with no tasks. All pre-reset hosted task IDs below are now historical evidence, not usable live fixtures. Saved reports remain valid observations of those earlier runs. The external API ledger was not reset.

Both benchmark runs are deferred at the human's request (C-B-20261018T043857Z-01); no automatic restart is authorized. This does not prevent the separately requested human buyer form.

### Hosted human form verified — 04:53 UTC

C-B-20261018T045049Z-01 confirmed the actual running judge uses `claude-opus-5-5`, default three provider attempts, no environment override, and the verified component. B enabled the expiring local policy under the existing API ledger, then submitted one bounded **50-cent Stripe TEST task through the browser form**: `task_0b688c85f6f5b867`. D's existing seller `seller_0213ff3d1ffc3278` claimed it with qwen3:8b. The UI automatically tracked it to APPROVED / CAPTURED / TRANSFERRED, displayed a finalized 50-cent seller transfer, and revealed the expected synthetic result only after commitment verification. The answer was hidden again; the form was cleared for the user's task. No private prompt or answer is included in evidence.

At 04:53 UTC the original B buyer had exactly one post-reset task, cap 2000 test cents, spent 50, reserved 0 and available 1950. Its deterministic `RUBRIC_MATCH` approval released the $2.20 API allowance; the shared ledger held **$0.002390 booked, zero open reservations**. These are ledger estimates and simulated payment amounts, not an invoice or real bank transfer. [Redacted hosted evidence](runs/web-buyer-hosted.json) records IDs, verification flags, settlement and balances. The test establishes the browser-to-marketplace flow, not general task quality or confidential computing.

At 05:00 UTC B directly read the existing row from the Insforge `tasks` table, selecting only task/request IDs, buyer, status, model, price, runtime and timestamps. The row matched the browser submission's saved request ID and original buyer; hosted `marketplace_info` also reported `Insforge Postgres`. This confirms that **Submit persists the task in Insforge**. Review drafts and recovery journals are local; the server stores private task specifications encrypted. No new purchase was made. See [database persistence evidence](runs/web-buyer-insforge.json).

D independently acknowledged the same task in `D-B-20261018T045731Z-01`: 5,453 ms in the Wassette sandbox, 11,127 ms end to end including 5,092 ms model load, 53 input / 2 output tokens, and `usage_complete: true`. D's seller read also confirmed APPROVE / RUBRIC_MATCH, no review retries or replacement, and a finalized 50-cent TEST transfer. These timings and token counts are **D-reported**, from its local recorder; B has not independently inspected the raw rows. They corroborate this smoke task only and do not constitute a benchmark or a measured resource-cost result. Benchmarking remains deferred.

Branch: `feat/b-buyer`, initially based on `19f7431`; incorporated C's integration and hosted deployment, then main through `82d0aa2` for the final Armature report. This records completed checks separately from disclosed coverage limits. No private responses, credentials, or ciphertext are included.

## Local checks

| Command / check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass with the generated web dependency lockfile update. |
| `pnpm -r typecheck` | All seven workspace packages pass. |
| `pnpm --filter @atm/web build` | Pass; Vite production bundle generated. |
| `pnpm --filter @atm/web test` | 17 tests pass: public rendering, payment/runtime labels, filtering, links/leases, MCP response handling and interrupted-response recovery, input validation, endpoint-bound identity, commitment failure handling, and unfamiliar settlement rail fallback. |
| Crypto tests | Initially six passed; seven pass in the merged workspace suite. |
| `pnpm test` after merging C's integration | Pass: 79 tests after incorporating D's payment guards — web 14, crypto 7, runner-core 19, agent-daemon 6 (+1 Wassette test skipped), marketplace server 33. The original missing-server-tests failure is resolved. |
| `pnpm -r typecheck && pnpm test` after CLI response-recovery fix | Pass: all workspace typechecks and 82 tests — web 17, crypto 7, runner-core 19, agent-daemon 6 (+1 Wassette test skipped), marketplace server 33. |
| `pnpm smoke` on main `8ace6e6`, 02:40Z | Pass: registered-key and per-claim flows both APPROVED with verified commitments; MEMORY storage, MOCK settlement, no external model or payment calls. |
| Skill creator `quick_validate.py skills/marketplace` | Pass. PyYAML installed in an ignored local validation environment. |
| `node scripts/buyer.mjs whoami` | Registers once, privately stores the key, then reuses the buyer. |
| `node scripts/buyer.mjs wait task_0406a62309ba9383 --timeout 1` | APPROVED, commitment verified, CAPTURED; redundant ciphertext absent from CLI result. |
| Buyer post with 2,001-cent budget on a 2,000-cent-cap buyer | `SPEND_CAP_EXCEEDED`, nonretryable; no extra task or hold created. |

Toolchain: Node 22.23.2, pnpm 10.33.2, Claude Code 2.1.302, Codex CLI 0.155.0-alpha.16. CLI help was checked for the documented MCP flags.

The CLI previously lost its uncertain-post recovery guidance when reading a response body failed after HTTP headers arrived, or when an incomplete/mismatched response could not be parsed. Those paths now return a structured, non-retryable client error directing the buyer to inspect existing tasks before repeating a post. Three local tests simulate an interrupted body, truncated JSON, and an unmatched response ID; each checks the recovery instruction and that only one tool request was sent. These are isolated transport tests with no server purchase or model call, not Armature case results.

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

B's hosted documentation and accepted-case evidence were merged from PR #2 at `a0b4c37`. C reports that workspace typechecks, 79 tests (one optional Wassette skip), and the offline smoke passed on the combined tree in `C-B-20261018T025512Z-01`. B independently checked `GET https://warm-cloud-4hh5i.run.mcp-use.com/api/health` at 02:50Z: HTTP 200, `agent-task-marketplace`, contract 0.2, card mode, Insforge Postgres. Use `/api/health` for application health; `/health` remains the framework endpoint.

## Armature accepted-task evidence from C

C's [redacted report](../ARMATURE-RESULTS.md) records run `e7b625cc-1d27-5d05-ba0a-4b1e178e4612`, case `6fedcf8e-56aa-4084-82f3-7ca2a9da81a5`, started at 02:40:41Z using Codex / GPT-5.6 Terra in the team's Armature account. The case passed 5/5, with all three criteria passing, 53.1 seconds of agent time, 9 recorded tool calls, and 0 failures. This is one accepted-task workflow evaluation, not an aggregate benchmark or five completed scenarios.

C reports this buyer sequence: `marketplace_info` → `register_agent` → `list_sellers` + `whoami` → one `post_task` → two `get_task` → `get_result`; the timeline also includes a later evaluator `list_my_tasks`. Registration used a 100-test-cent cap. The result was APPROVED with `commitment_verified=true`; the agent distinguished commitment verification from judge approval. No new wording defect was reported in this accepted flow after A incorporated B's guidance findings.

B independently read the hosted public dashboard and confirmed task `task_19a38f56a2162259`: APPROVED, CAPTURED, APPROVE / RUBRIC_MATCH, STRIPE_TEST settlement with 75-cent seller payout and 25-cent buyer refund. The private result and tool trace remain in the team Armature account; B did not obtain another buyer's credential or repeat its purchase. [Open the run](https://app.armature.tech/eval/runs?range=7d&drawer=run%3Ae7b625cc-1d27-5d05-ba0a-4b1e178e4612). C saved `outputs/armature-accepted-pass.jpg` on its machine with tool payloads closed (corrected filename from `C-B-20261018T025512Z-01`); it is not a screenshot captured locally by B.

C's UI initially reported zero of 1000 monthly Armature credits used after this run, then 10 of 1000 on a later visit before the follow-up runs. That delayed counter is neither proof model inference was free nor an itemized bill. No token-billing figure was supplied. The 75-cent marketplace amount is simulated Stripe money and is not measured compute cost.

## Armature follow-up evidence from C

C's handoff `C-B-20261018T025917Z-01` and the updated [report](../ARMATURE-RESULTS.md) record two further passing cases using the original buyer and its human-approved bearer profile:

| Case | Run | Reported outcome |
| --- | --- | --- |
| Spending-cap rejection | `25fd9a0a-0d07-5116-bac9-6bb3029770d8` | 5/5 across three criteria, 25.1 seconds; six agent calls, nine including evaluator checks. One valid 100-cent post returned the expected `SPEND_CAP_EXCEEDED` error. No task or payment was created. |
| Simulated missing-task-ID recovery | `a03651eb-66cf-52da-816d-bb015752874a` | 5/5 across three criteria, 30.9 seconds; eight read-only agent calls, nine including evaluator checks, zero errors. The agent used `list_my_tasks`, then `get_task` and `get_result`, recovering the existing approved task without posting. |

The initial recovery run `50f7cfe8-88a7-534e-8c90-fc3f379ca139` used an incorrect fixture description. C corrected it and repeated only the read-only case. Preserve that first run as historical evidence, not another independent scenario. This was simulated missing-ID uncertainty; it did not inject a real transport disconnect. B's separate local CLI tests cover interrupted response handling and are not Armature evidence.

C reports that before and after these checks the buyer had a 100-cent cap, 75 spent, zero reserved, 25 available, and exactly one APPROVED task. Its OPEN and REJECTED queries were empty. B independently rechecked the hosted public snapshot at 03:01Z and found the accepted task still APPROVED / CAPTURED. Balance, ownership-filtered inventory and private tool traces are attributed to C; B did not obtain C's buyer credential or duplicate a purchase.

The final screenshot on C is `outputs/armature-three-cases-pass.jpg`, with tool payloads closed. It shows three passing cases across four runs, including the corrected recovery rerun. No raw trace, credential, private task text or private result was copied into this repository.

## Coverage limits

### V1 controlled disconnect — 03:15:41Z

`node scripts/benchmarks/disconnect-check.mjs` passed against an isolated real marketplace MCP server in MEMORY/MOCK mode. A loopback HTTP proxy read the successful upstream post result, then sent headers plus an incomplete JSON body and destroyed the TCP response. The actual buyer CLI exited with `CONNECTION_FAILED` and recovery guidance. A new OS process using the same isolated identity called `tasks`, found exactly the accepted task, and did not call `post_task` again. Proxy count: one post. The buyer had 100 cents reserved and zero spent, then cancellation returned reserved/spent to zero; final state was CANCELLED / MOCK. No external model, payment or shared-hosted call occurred. The [redacted JSON](runs/disconnect-v1.json) records the concrete task ID and assertions; this tests real response loss, not simulated omission of a known ID.

Pending-seller and rejected-result Armature cases remain **not run**. The configured buyer owns neither an OPEN nor a REJECTED fixture, and its remaining 25 test cents cannot fund the 50-cent minimum card task. The cap was not raised, another identity was not created, and shared workers were not paused to complete those cases. The [case table](evaluation.md) records these limits instead of claiming complete coverage. E's separate rejection checks do not substitute for this buyer-agent evaluation. D separately records human-approved Link-wallet test payments in [payments verification](../payments/README.md); B did not repeat that payment flow.

## Buyer jobs, task offers and UI checks (04:12–04:14Z)

B implemented deterministic splitting of independent records, stable server request keys, atomic private journals, bounded resume, and aggregation of APPROVED + commitment-verified parts with exact record-ID checks. `pnpm exec tsx scripts/benchmarks/job-check.mjs` passed against an isolated real v0.3 MEMORY/MOCK server: a TCP response was cut after the first part was accepted, then a fresh CLI process resumed the same job. Exactly two posts created two parts; four verified records were aggregated in original order. Buyer and job budgets ended at 200 MOCK cents spent, zero reserved, within the 200-cent ceiling. The synthetic model ran in the labelled node-unsandboxed test path; this proves orchestration, encryption/commitment handling and recovery, not inference quality or two physical machines. See [redacted job evidence](runs/job-v03.json).

The same isolated test submitted a synthetic private marker as a judge explanation; the public dashboard API excluded it. UI tests separately project away private task fields, verdict text, event metadata, settlement notes and free-form job/part labels. They cover missing/unverified/malformed part exclusion, partial failures, endpoint/buyer/plan mismatch, owed versus transferred amounts, pending replacement/review and completed transfers overriding historical onboarding notes.

Validation: workspace typecheck passed; workspace tests passed (203 tests, two optional Wassette tests skipped), then the additional stale-onboarding regression passed with the web suite at 22/22. Web production build and benchmark unit tests (3/3) passed. The original standalone real-disconnect check also passed again against v0.3 (one post, reserve 100→0). All 24 saved baseline/local usage records validate against shared `UsageRecord`, and paired case hashes/order match the locked protocol.

B inspected the live browser dashboard after these changes. It shows C's parent `job_6487101b45b433f1` COMPLETE, with one APPROVED 60-cent part assigned to `seller_07a57bbbd50fd91e` (C) and one to `seller_0213ff3d1ffc3278` (D), 120 cents spent, zero reserved, and confirmed 60-cent transfers. [B's public observation](runs/cd-public-observation.json) verifies only public metadata. C reports private commitment verification and 75.1 seconds of execution overlap; see `C-B-20261018T041011Z-01` and [C's live report](../LIVE-C-D.md). C prepared these parts explicitly, so this live rehearsal is separate from B's automatic decomposition test. No duplicate live purchase was made.

The dashboard now reads the public market-observation tool, displays sample counts and insufficient-data states, and treats offers as buyer choices. Seller asks are removed. Replacement status and seller transfer status are independent of task approval. B has no rehearsal video; a human/C/E operates the recorder. Marketplace benchmark execution and the two missing Armature fixtures remain pending the documented budget/fixture dependencies.

The job proof was rerun at 04:15:59Z with the same synthetic marker embedded in both the private task instruction and the ignored judge explanation; it passed and neither reached the public API. Benchmark budget validation now rejects a corrupted persisted ledger; its unit suite passes 4/4. Buyer/payment usage records for the marketplace arm validate against the shared schema. A read-only preflight confirmed B's original buyer still has 1,850 test cents available, zero reserved; C and D advertise the same pinned qwen3:8b digest in Wassette. No benchmark purchase was made by that preflight.


## Unified release: independent B verification (2026-10-18, 06:32–06:38 UTC)

C deployed `ba09f07a5a592a0c191a4d970277b8774eb0a063`. B independently verified the hosted health revision, the `/marketplace/` page, its JavaScript and CSS assets (HTTP 200), and the canonical redirect (308). After reloading the actual public site, the browser displayed live refresh, one existing task, six sellers including four awaiting runner setup, insufficient market samples, and the existing confirmed 50-cent Stripe TEST transfer. The public dashboard field scan found no private task/result fields. Hosted submissions remain unavailable and `/api/buyer` returns 404. The earlier failed rollout remains recorded in [hosted-board.json](runs/hosted-board.json); [unified-release.json](runs/unified-release.json) records this successful follow-up.

Independent commands on the integrated release: `pnpm --filter @atm/web typecheck`; `pnpm --filter @atm/web test` (32 passed); `pnpm --filter @atm/agent-daemon exec vitest run test/seller-dashboard.test.ts test/dashboard-chat.test.ts` (7 passed); and `pnpm --filter @atm/marketplace-mcp exec vitest run src/human-account.test.ts src/provider-budget.test.ts` (6 passed). These isolated tests cover ownership, payment readiness, local chat/tool decisions and shared reservation behavior; they are not a live human signup or purchase. C separately reports the full workspace gate at 265 passed and two optional skips in `C-B-20261018T063400Z-01`.

A direct read of Insforge's persistent `provider_budget/shared-judge` row confirmed revision 0, a 5,000,000-microusd cap, 2,390 microusd booked and zero open reservations. B's old local ledger still has the same booked amount and remains unchanged as audit evidence. Its local submission policy is disabled to avoid using both ledgers after migration. No account receives a new external API allowance. Stripe TEST prices remain separate from the actual external API budget.

The shipped unified workspace is the installer dashboard at `http://127.0.0.1:43118`, with one Google account, buyer payment setup, local model chat and seller controls; see [the unified workspace guide](../UNIFIED-WORKSPACE.md). B has not completed Google/Stripe acceptance or a live chat-to-worker purchase on that installed dashboard. This verification made zero purchases and zero external model calls. Benchmarks remain deferred, and the remaining Armature pending-seller/rejected cases still lack authorized owned fixtures.
