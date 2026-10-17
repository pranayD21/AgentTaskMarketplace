# Project plan

## Goal

Build a hackathon demo of a marketplace where one agent pays another agent to run a task on spare local compute. The buyer posts the task's allowed models and maximum mock price without publishing the prompt. A seller with an installed local model claims the job, receives the private task, runs the model, and returns a result. A judge checks the result against the buyer's rubric. The marketplace records a mock payout only when the judge approves it.

The source idea also calls for confidential virtual machines, verified model identity, automatic seller bans, real payments, and possible on-chain records. Those need more infrastructure and evidence than this first demo. [Security and demo claims](SECURITY_AND_CLAIMS.md) states what the prototype can show.

## One complete demo run

1. A buyer enters a prompt, context, allowed model IDs, maximum mock price, and a short grading rubric. The buyer explicitly allows the demo judge to inspect the private task and result. The mock ledger reserves the maximum price when the listing is created.
2. The buyer client sends only listing metadata to the marketplace. The public job list does not contain the prompt, context, or rubric.
3. A seller worker reads its locally installed Ollama models, registers its available model IDs, and claims a matching job. The API accepts one eligible claim at a time and gives it a lease.
4. After the claim, the buyer encrypts the private task for that seller and for the consented judge. The API relays ciphertext. The seller decrypts its copy, checks that the claimed model is still installed, and runs it through the local Ollama API.
5. The seller encrypts the result for the buyer and judge. The judge applies the buyer's rubric or a checkable test and records an approval or rejection with a reason.
6. An approved job pays the accepted claim price in mock credits and refunds any unused reserve. A rejected job refunds the full reserve, produces a zero-payout record, and updates the seller score. One rejected answer alone does not prove malicious behavior or trigger an automatic ban.

The main demo should use a small, non-sensitive task with an answer the team can check. Show a rejected result in a separate test or demo run. If the judge does not produce a replacement answer, say so; the buyer then gets the submitted result and the verdict.

## Technical choices for the first build

| Part | Default | Reason |
| --- | --- | --- |
| Marketplace API | Python, FastAPI, SQLite | One API owner can build and run the control plane on a laptop. SQLite stays on A's machine; other computers call the API. |
| Buyer client and MCP entry point | Python | Shares request models and encryption helpers with the seller and API. MCP is an adapter to the buyer flow, not a second marketplace protocol. |
| Buyer web interface | React and Vite | A small interface for posting, watching, and reading jobs. |
| Seller worker | Python and local Ollama HTTP API | Reads installed model IDs and executes a claimed job without a cloud inference dependency. |
| Private handoff | Libsodium sealed boxes through maintained language bindings | The API stores and relays ciphertext. D owns the exact helper functions and test vectors. |
| Judge and payment | Python judge worker and mock credit ledger | Lets the team demonstrate review and payout rules without payment credentials or a live chain. |

Run the marketplace API on A and set `MARKETPLACE_BASE_URL` on the other machines. Use a trusted development network, demo bearer tokens, and non-sensitive tasks. A production network needs transport security, stronger identity, abuse controls, and a separate key-distribution review. Keep tokens, keys, prompts, results, SQLite databases, and model files out of Git.

The seller host can inspect its own process and plaintext during inference. Encryption protects the handoff while the API stores or relays it, subject to the demo's trusted key distribution. Wasmtime or Wassette may sandbox a narrow tool component that the seller runs, but the local Ollama model is outside that sandbox. Do not describe this build as confidential inference or a confidential VM.

### Named technologies from the idea discussion

The buyer MCP adapter uses Manufact's local [`mcp-use` SDK](https://manufact.com/developers). [Wasmtime](https://docs.wasmtime.dev/security.html) or Microsoft's [Wassette](https://github.com/microsoft/wassette) can support an optional sandboxed tool demonstration; neither makes ordinary local Ollama inference confidential from its host. x402 or Stripe payments and an on-chain audit trail are stretch work. The transcript also suggests Blaxel, InsForge, Primitive, and Inkbox. None is needed for this local MVP, so an owner should propose a specific use and verify its current API before adding one.

## Five owners

| Computer | Owns | Deliverable and boundary |
| --- | --- | --- |
| A | `apps/api/`, `packages/contracts/`, `docs/CONTRACT.md`, shared root setup files | On `work/A-api`, publish the v0.1 contract, implement listings, registration, atomic claims, leases, encrypted-envelope storage, job states, and integration merges. After bootstrap, A maintains `README.md`, `AGENTS.md`, `.gitignore`, shared project docs, and task briefs. A decides shared API changes after reading the other owners' requests. Directed message files stay under their sender's ownership. |
| B | `apps/buyer/`, `apps/web/` | On `work/B-buyer`, build the buyer client, MCP entry point, and web flow. Keep prompt/context local until a claim exists; use D's encryption helper for the handoff. Develop against contract fixtures until A's API is ready. |
| C | `apps/seller/` | On `work/C-seller`, discover actual local Ollama model IDs, register them as self-reported availability, poll and claim jobs, renew leases, run inference, and submit encrypted results. Fail clearly if the selected model is missing at run time. |
| D | `packages/security/`, `apps/runner/` | On `work/D-security`, implement sealed-box helpers, key handling, and an optional limited execution adapter. If built, demonstrate what the sandbox blocks. Document the boundary of any Wasm tool; do not imply the model runs in a TEE. |
| E | `apps/judge/`, `apps/payments/`, `tests/e2e/`, `demo/` | On `work/E-judge`, implement the consented judge, reputation counters, mock payout worker, end-to-end checks, and the demo script. Use the API contract to submit verdicts and settlement records. |

Each owner edits only assigned paths and sends contract changes to A through the directed coordination file. [The contract](CONTRACT.md) is the shared source for field names and state transitions. For any approved revision, A makes a contract-only commit on `main`, sends its commit SHA to B, C, D, and E, and asks them to fetch and merge `origin/main` before adopting the new fields. Owners can use local fixtures while endpoints are unfinished. A mock must stay visibly labeled in code and in the demo.

## Build order and merge gates

1. **Bootstrap and contract.** The setup commit with the repository structure, task briefs, and v0.1 contract is already on `main` before A starts. Each computer starts from its prepared `work/<LETTER>-...` branch. A resolves interface questions before owners change shared fields.
2. **Parallel slices.** A builds the API and SQLite state machine. B builds the buyer screens and client against fixtures. C builds the Ollama worker against fixtures. D builds encryption and sandbox checks. E builds the judge, mock payout logic, and end-to-end test harness.
3. **First integration.** Merge A and D, then prove that the API holds only encrypted private payloads. Merge C and show one remote seller registration and claim. Merge B and submit a task from the buyer flow. Merge E after the result path works.
4. **Demo rehearsal.** Run the full path on two machines if available: one hosts the API and buyer, the other hosts Ollama and the seller worker. The remaining computers can continue coding and testing. Repeat the approved path, the rejected path, and a lease-expiry retry.

The merge gate for every slice is a short handoff with the branch and commit, run command, test result, and any unfinished behavior. A checks contract compatibility and the end-to-end path before merging it into `main`. The 20 directed coordination files and their delivery rules live in [`coordination/README.md`](../coordination/README.md).

## MVP acceptance checks

- `GET /v1/jobs` returns listing metadata with no prompt, context, rubric, or private ciphertext.
- Two sellers racing to claim the same job produce one active `claim_id`. A lease can expire, and an old claimant cannot submit a late result.
- The buyer uploads the private task only after a claim. The API persists encrypted envelopes, and the seller receives only its own envelope.
- The seller uses a model ID returned by its local Ollama installation and returns a real local inference result. A missing model produces a clear failure rather than a fabricated answer.
- The buyer and the consented judge can decrypt their respective result envelopes and verify the same result commitment. The judge records a reason with each verdict.
- Job creation reserves the maximum price in mock credits. Approval pays the claim price and refunds the difference. Rejection or final expiry refunds the reserve. A retry cannot create a second payout or refund.
- The buyer UI shows the job state, verdict, and mock payout status. The demo script works from a clean local setup using non-sensitive sample data.
- Any sandbox demonstration identifies the specific tool and granted permissions. It makes no claim about concealing the task from the seller host.

## After the hackathon MVP

Real payments through x402 or Stripe, an on-chain audit trail, stronger identity and dispute handling, hardware-backed confidential execution, remote attestation, and verifiable model identity are separate projects. Add each only with a tested implementation and evidence that supports the corresponding claim. Seller suspension needs a review policy and an appeal path; a single low-quality answer is not enough.
