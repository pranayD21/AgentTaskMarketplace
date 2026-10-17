# Security and demo claims

This is the trust model for the hackathon MVP. Treat each demo claim as a statement to verify in the running build, not as a feature promised by the plan.

## Who can see a task

The public job listing should contain an ID, allowed model names, price, deadline, and status. Keep the buyer's prompt and context out of the listing, public Git files, and routine logs. Send that payload only after a seller claims the job. If the marketplace server relays plaintext, its operator can read it. The seller controls the computer that runs inference and may inspect the payload, process memory, or logs. Use non-sensitive demo tasks until the team has a reviewed confidential-computing design.

A SHA-256 digest can help detect a changed payload or bind a result to a job. A digest does not hide the original text; short or predictable prompts may also be guessed. Use encryption for secrecy in transit or storage, and name who holds the keys. Encryption to an ordinary seller process still leaves the plaintext visible to that computer's owner while it runs. See [NIST's hash definition](https://csrc.nist.gov/glossary/term/Cryptographic_hash_function).

## Runtime and model limits

[Wasmtime](https://docs.wasmtime.dev/security.html) limits what a WebAssembly guest can access, including filesystem access granted through WASI. Microsoft's [Wassette](https://github.com/microsoft/wassette) runs WebAssembly components as MCP tools with explicit permissions and uses Wasmtime. These controls help protect a seller's computer from untrusted tool code. They do not conceal a buyer's prompt from the seller's operating system. Wassette's repository also labels the project as early development. Running an AI model inside a confidential VM would require a separate design with suitable hardware, attestation, key release, and a model runtime that actually runs inside that boundary. Do not call a Wasm sandbox a confidential VM or a TEE.

For a local inference demo, [Ollama's local API](https://docs.ollama.com/api) can list installed models through [`GET /api/tags`](https://docs.ollama.com/api/tags) and generate output through [`POST /api/generate`](https://docs.ollama.com/api/generate). A seller-reported model name or digest shows what that seller's API reports. It does not prove to a remote buyer which weights produced a given answer. A quality check cannot prove model identity either.

## Judging and payment

Tell buyers before submission whether a judge may receive their prompt, context, or output. Obtain that choice explicitly and send judges only the data needed to apply the buyer's rubric. For the demo, use tasks with a checkable answer or buyer-supplied tests. A sampled judge verdict is a quality signal, not proof that every result is correct. Record why a result failed before changing a seller's rating or suspending an account.

[x402](https://docs.cdp.coinbase.com/x402/how-it-works) provides an HTTP payment handshake with verification and settlement. Its documented flow can settle after work and supports deferred settlement, but this project must implement its own rule for when a judge accepts work, who gets paid, and what happens on disagreement. A local balance or simulated payout is a mock payment. Do not describe it as an escrow, a completed on-chain transfer, or a guarantee that sellers will be paid. If the team adds real x402 settlement, show the network and transaction evidence in the demo.

## Claim checklist for the demo

Say these only after checking the running system:

- Public job listings omit the prompt and context.
- A seller machine calls a downloaded local model and returns its output.
- The buyer verifies the submitted payload or result digest.
- A specific WebAssembly tool runs with the permissions shown in the demo, if Wasmtime or Wassette is integrated.
- A judge evaluates a consented result, and the app records the verdict and payment state. Label simulated balances as **mock**.

Do not claim host-proof buyer confidentiality, hardware-backed confidential inference, cryptographic proof of model execution, guaranteed answer quality, automatic fair judging, escrow, or on-chain settlement until each has a separate implementation and a test that demonstrates it.
