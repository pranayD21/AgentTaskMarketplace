# Computer D: private handoff and execution isolation

You own `packages/security/` and `apps/runner/`. Work on `work/D-security`. Read the root `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md` before coding. Ask A about contract changes in `coordination/messages/D-to-A.md`.

## Build

1. Implement the contract's buyer-to-seller and seller-to-buyer encrypted envelopes. Provide a small Python API and examples B and C can run locally. Include ciphertext tamper detection, key generation/storage guidance, and clear failure on a wrong recipient or modified ciphertext. Keep private keys on the endpoint computers. The API token authorizes the uploader; a sealed box alone does not authenticate its sender.
2. Support the judge envelope for consented jobs and implement the contract's result commitment helper so buyer and judge can verify they decrypted the same answer. Document exactly which computer or process can decrypt each envelope. Give B, C, and E fixtures that use synthetic text and test keys only.
3. Prototype a restricted Wasmtime or Wassette tool runner if time allows after the handoff works. Limit guest filesystem, network, and host calls by explicit permissions. Record a test showing the restriction. The local model runtime may stay outside this tool sandbox; state that boundary in the demo.
4. Write a short threat model beside the implementation: who controls the buyer, marketplace, seller host, and judge; what encryption protects in transit and storage; and which plaintext each host can still inspect. Do not call the prototype a confidential VM or claim remote attestation.

## Verify and hand off

Test correct decrypt, wrong-key failure, tamper failure, and buyer-authorized judge access. If you build the tool runner, test a denied filesystem or network action and a permitted action. Send B and C the API and fixture in `D-to-B.md` and `D-to-C.md`; send E the judge envelope path in `D-to-E.md`. Include commit, commands, and remaining trust limits in each handoff.
