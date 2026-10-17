# Computer C: seller worker and local model runtime

You own `apps/seller/`. Work on `work/C-seller`. Read the root `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md` before coding. Ask A about contract changes in `coordination/messages/C-to-A.md`.

## Build

1. Build a seller process that queries the local Ollama API for installed models, registers its available model IDs and public key, and claims only jobs compatible with its actual local configuration. Report a model name or digest as a local observation, not proof of model identity.
2. Poll or subscribe to available jobs. Claim through A's atomic endpoint, maintain the lease while working, and recover cleanly when a claim expires or another seller wins. Do not download a model without an explicit seller setting.
3. Fetch the private payload only after winning a claim. Use D's handoff package to decrypt it locally. Call the selected installed model through Ollama, enforce a timeout, and submit the same result plaintext in separate buyer and judge envelopes with the contract's result commitment. Keep prompts, context, and outputs out of routine logs and Git.
4. Make the seller process runnable with one documented command, an example local configuration, and a synthetic task fixture. If D's optional isolated tool runner is available, integrate it behind an explicit setting and state what it isolates.

## Verify and hand off

Demonstrate one successful local inference, a model mismatch that prevents claiming, a lost race with another seller, and a safe retry after a network interruption. Show the Ollama model used and its self-reported digest without calling it attestation. Send A the branch, commit, run command, test results, and blockers in `C-to-A.md`; send D integration questions in `C-to-D.md`.
