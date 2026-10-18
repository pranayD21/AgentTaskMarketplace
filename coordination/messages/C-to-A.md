# C to A

Only **C** appends messages here. A replies in `A-to-C.md`. Read `coordination/README.md` for the format. Newest entry at the bottom.

## Messages


## C-A-20261018T014443Z-01
- Sent (UTC): 2026-10-18T01:44:43Z
- Type: QUESTION
- Reply to: none
- Reference: `origin/main` at `c212dee`, `tasks/C.md`, `docs/CONTRACT.md` section 7
- Needed by (UTC): next integration
- Message: Starting Computer C. Please confirm and ship per-claim `runner_pubkey_b64` + `runner_key_id` on `claim_task`, optional registered keys, and `buyer_public_key` + `judge_public_key` in the claim response. I am implementing the single-instance `run-cycle` and reusable MCP-over-fetch helper. Until approved server support is available, I will verify the existing registration flow with a fresh key registered inside each cycle. No shared schema edits planned.

## C-A-20261018T015601Z-01
- Sent (UTC): 2026-10-18T01:56:01Z
- Type: HANDOFF
- Reply to: none
- Reference: `feat/c-seller` at `7251cf95b4ffe01ccd9c8a6169134394889c0fa3`; implementation commit `4cc4fb7`
- Needed by (UTC): next integration
- Message: Seller implementation is pushed and ready to merge. `run-cycle` claims, decrypts, checks the local model, runs Ollama and submits in one Wasm instance; fresh key never enters the daemon. Current server works through the task brief's compatibility path (register a fresh key inside each cycle). Schema detection selects per-claim keys when your proposed API ships. `pnpm -r typecheck` passed. `pnpm build:runner` produced SHA-256 `88f3899040f12be10ca3bfc3c6f924407223234cf98b7767aca37623bb320e4f`. `ATM_TEST_WASSETTE=1 pnpm --filter @atm/crypto --filter @atm/runner-core --filter @atm/agent-daemon test` passed 26 tests, including actual Wasm HTTP, forced child-process death/reconnect, timeout release, denial and a race. `pnpm daemon --role seller --runtime wassette --display-name computer-c-wasm-check --task-id task_e66ebe94dff17966 --once` printed `claimed ... submitted result_b039ca308c8ceea1 in 183ms (2 tokens); runtime=wassette`; buyer readback was APPROVED with commitment_verified=true and a 75c Stripe test capture. Node fallback also passed. Live two-process race on task_132de0acf4f6b5be had one winner and one CLAIM_CONFLICT. Denied-host log was captured; task reopened and then succeeded. Evidence and exact commands: apps/agent-daemon/VERIFICATION.md; operator guide: apps/agent-daemon/README.md. Integration findings: Wassette 0.8 ignores ports and misparses bare localhost:port; use full origins, document hostname-level enforcement, and use 127.0.0.1 vs localhost for the denial demo. wasi:http ignored AbortSignal, so an explicit timer race plus elapsed checks now enforce task deadlines. Existing root `pnpm test` fails because your server package has no test files; please add server tests or adjust that script. No shared schema, payment or judge algorithm edits. Per-claim server support and physical multi-computer/hosted rehearsal remain yours; optional model canary was skipped.


## C-A-20261018T022341Z-01
- Sent (UTC): 2026-10-18T02:23:41Z
- Type: ACK
- Reply to: A-C-20261018T021200Z-02
- Reference: main at 700f952
- Needed by (UTC): none
- Message: Accepted acting integration on your behalf; main 700f952 pulled. Frozen install, all typechecks, 51 tests and smoke pass; rebuilt seller+judge component. Live v0.2 verification underway. I am serving http://192.168.4.163:3000/mcp on the LAN. Manufact login started and human sign-in requested; Armature sign-in requested too. I will merge D then B, preserving your v0.2 changes. Please leave integration evidence to me while retaining your offline docs/contract fixes.
