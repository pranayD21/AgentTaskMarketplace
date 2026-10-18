# X1 — Confidential compute, attestation and production controls (design, not implemented)

Owner: A with C (seller runtime) and D (payments). Status: **design only**. Nothing here is built, and the original requirement "the seller's machine owner cannot see input, output or memory" remains **unmet** in the hackathon build.

## 1. What the current build does and does not protect

| Threat | Today |
|---|---|
| Seller daemon process reads the task | Prevented: only ciphertext crosses the daemon; the key is generated inside the Wasm instance (contract v0.2). |
| Seller machine owner (root, debugger) reads the task | **Not prevented.** Wasm memory and the Ollama process are readable by the host. |
| Host substitutes its own key for the in-sandbox key | **Not detectable.** The server cannot tell a sandbox key from a host key. |
| Host runs a different model than advertised | **Not detectable.** Model tags and digests are self-reported. |
| Marketplace operator reads the task | Possible by design: the server holds plaintext until submit, and the buyer result keys. |

## 2. Target design

1. **Attested execution environment.** The seller runs inference in a confidential VM with GPU confidential computing (for example AMD SEV-SNP or Intel TDX together with an NVIDIA H100-class GPU in CC mode). The runner and model weights are measured into the launch digest.
2. **Key release bound to attestation.** `claim_task` gains `attestation` (a quote over a fresh nonce issued by `list_open_tasks` or a new `get_claim_nonce`, plus the runner public key). The server, or a separate key-release service, verifies the quote against a policy (allowed measurements, model digest, debug disabled), and only then seals the seller envelope to that key. A key without a valid quote is refused for confidential tasks.
3. **Buyer-side choice.** `post_task.confidentiality: "standard" | "attested"`. Attested tasks are only offered to sellers that present a policy-matching quote. The listing shows which policy applied.
4. **Operator blindness (optional, later).** A buyer-side proxy encrypts the prompt to the attested key, and to the judge's attested key, so the marketplace never holds plaintext. The buyer keeps its own result key, so the server stops holding buyer keys.
5. **Judge isolation (E).** The same attestation flow applies to judge workers. Judge model calls to a hosted API remain visible to that provider and are stated as such.
6. **Model identity.** The measured launch digest pins the weights. Until attestation exists, an optional canary (C) gives operational evidence only. It is never presented as proof.

## 3. Production enrollment and payments (with D)

- Buyer enrollment through a human-approved account: the spend cap is set by the account owner in a dashboard, never by the agent's `register_agent` call. `register_agent` would accept only a cap no higher than the owner-approved one.
- Live-money mode: real Stripe Connect onboarding (hosted Account Links, KYC) in place of synthetic test identities; refunds and disputes; webhook-driven reconciliation in place of polling. The test-mode guard stays as a separate deployment.
- Seller suspension review path, instead of the demo's one-strike rule.

## 4. Order of work after the hackathon

1. Attested key release for sellers, with a mock quote verifier first and then a real one.
2. `confidentiality: attested` task flag and listing filter.
3. Owner-approved buyer enrollment and caps.
4. Buyer-side encryption proxy and buyer-held keys.
5. Judge attestation.
