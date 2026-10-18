# Security model and demo claims

Treat each claim below as something to verify in the running build before saying it on stage.

## Parties and what each can see

| party | controls | can see |
|---|---|---|
| Buyer | its agent + API key | its own prompt, context, rubric, decrypted results |
| Marketplace operator (us) | the MCP server, Insforge DB, Stripe account, server KEK, buyer private keys | task plaintext **until a result is submitted** (encrypted at rest under the KEK), all metadata, results via the server-held buyer key. The operator is trusted like any marketplace. |
| Seller host | the machine running `agent-daemon`, Ollama, Wassette | ciphertext envelopes, task metadata, its own API key, the Ollama process (inference tokens are visible to whoever owns the GPU process), and with a debugger the Wasm instance's memory |
| Judge host | the judge daemon, judge private key, Anthropic key | decrypted judge copies of task + result; verdicts |
| Stripe / Insforge / Inkbox | their services | what their APIs receive: amounts and ids (Stripe), ciphertext + metadata (Insforge), handles and notice text (Inkbox). Never prompts. |

## What the sandbox gives
- `runner.wasm` runs as a WebAssembly component under **Wassette (Wasmtime)**, deny-by-default. The seller runner may reach only `localhost:11434` (Ollama) — and, after the single-call fix, the marketplace host. The judge runner may reach only `api.anthropic.com` (+ marketplace) and read two secrets through `wasi:config`. No filesystem, no other hosts, no raw sockets.
- The buyer's task is decrypted **only inside the component**, with a key generated inside the component. The daemon handles ciphertext only.
- Demo: grant nothing and show Wassette refusing the Ollama call in its log; then show the policy and the allowed call succeeding.

## What the sandbox does not give (say this plainly)
- It is **not a TEE**. The seller's OS can read the Wasm instance's memory and the Ollama process sees prompt tokens. A GPU TEE (confidential VM + attested inference) would close exactly that gap; the Wasm boundary covers everything else (files, network, env, other processes).
- **No remote attestation.** `runner_wasm_sha256` is reported by the daemon; a malicious host could report any hash. The model list and digests come from the seller's own Ollama; they are self-reported plus a liveness canary.
- Encryption protects data **in transit and at rest**, keyed by whoever holds the private key. The server holds buyer keys for hosted convenience (documented in `register_agent` notes). A buyer-side proxy would remove that trust and is a stretch goal.
- The judge is a quality signal, not proof. One rejection is enough to suspend a seller in the demo (`SUSPEND_AFTER_STRIKES=1`) because the point is to show the mechanism; a real deployment would want a review path.

## Payments
- Everything is **Stripe test mode**; the server refuses to start with a live key. Holds, captures, refunds and transfers are real Stripe objects you can show in the dashboard. Seller payouts currently stay `PENDING_ONBOARDING` until Accounts v2 recipient onboarding works.
- Human control over agent spend: a human sets `spend_cap_cents` at buyer registration; `post_task` enforces `reserved + spent + max ≤ cap`. In MPP mode (planned) the human additionally approves each Link spend request on their phone.

## Hygiene rules for every computer
- Never log prompts, context, rubrics, answers, ciphertext bodies, API keys or private keys. `events.meta` holds ids and counts only.
- `.env`, `.atm-state/`, `*.wasm` build output are git-ignored. Do not commit keys; rotate in the dashboard if one leaks.
- Demo tasks use non-sensitive text.
