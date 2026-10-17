# Computer D: private handoff and execution isolation

You are Computer D. This is your complete starting brief: follow the setup and reading steps here, then build, test, commit, push, and send a handoff. The human only needs to assign you this letter and give you repository write access.

## Project and setup

The hackathon demo is a marketplace for agent tasks on spare local compute. A buyer publishes metadata without a prompt, an eligible seller claims the job, the buyer sends encrypted task data, a local Ollama model produces a result, and a consented judge records a verdict before mock credits are settled. Real confidential inference, model attestation, live payments, and on-chain records are outside the first demo unless separately implemented and verified.

Repository: `https://github.com/pranayD21/AgentTaskMarketplace`. On a fresh computer, run:

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/D-security
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If the repository is already cloned, fetch from `origin`, switch to `work/D-security`, and create the coordination worktree only if it does not exist. Do coding in `work/D-security` and use the second checkout only for messages. Do not merge `coordination` into your code branch.

Before coding, read `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md`. `docs/CONTRACT.md` is the exact v0.1 API and data contract; use its field names and state transitions. Computer A owns contract changes. Work only in your owned paths and ask the relevant owner before depending on an unmerged interface change.

## Communication and handoff

Your four outbound files are `D-to-A.md`, `D-to-B.md`, `D-to-C.md`, `D-to-E.md`. Your inbound files are `A-to-D.md`, `B-to-D.md`, `C-to-D.md`, `E-to-D.md`. Only you edit your outbound files. To contact A, append a dated entry to `coordination/messages/D-to-A.md` in the coordination worktree; A replies in `A-to-D.md`. Each entry needs a unique ID, type, concrete message, and optional reply-to ID, as shown in `coordination/README.md`.

Fetch `origin/coordination` before reading incoming messages, at the start of work, roughly every 10 minutes, and before handoff. Commit and push each outgoing message to `coordination`; a local edit is not delivered. If a push loses a race, fetch, rebase the coordination worktree onto `origin/coordination`, and retry without force-pushing. Keep prompts, results, credentials, keys, and payment details out of Git.

Read an incoming file from your code checkout with `git fetch origin coordination` and `git show origin/coordination:coordination/messages/A-to-D.md`. To send, use this pattern in the coordination worktree:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append a new entry to coordination/messages/D-to-A.md.
git add coordination/messages/D-to-A.md
git commit -m "coord: D to A handoff"
git push origin HEAD:coordination
```

Use a heading such as `## D-A-YYYYMMDDTHHMMSSZ-01`, then record `Sent (UTC)`, `Type`, `Reply to`, `Reference` (branch and commit), `Needed by (UTC)`, and one concrete `Message`. For another recipient, replace `A` in the filename and ID. A recipient answers in its reverse file. Never edit another computer's file or revise an old entry; correct a mistake with a new entry. If a push is rejected, repeat the fetch, rebase, and push steps.

When A announces a new contract commit on `main`, commit or stash your work, run `git fetch origin main` and `git merge origin/main` on `work/D-security`, then continue against the merged contract. Treat an unmerged proposal as a proposal. At handoff, push `work/D-security` and send A your commit SHA, run command, test result, remaining blocker, and any interface change through `D-to-A.md`.

## Assignment

You own `packages/security/` and `apps/runner/`.

## Build

1. Implement the contract's buyer-to-seller and seller-to-buyer encrypted envelopes. Provide a small Python API and examples B and C can run locally. Include ciphertext tamper detection, key generation/storage guidance, and clear failure on a wrong recipient or modified ciphertext. Keep private keys on the endpoint computers. The API token authorizes the uploader; a sealed box alone does not authenticate its sender.
2. Support the judge envelope for consented jobs and implement the contract's result commitment helper so buyer and judge can verify they decrypted the same answer. Document exactly which computer or process can decrypt each envelope. Give B, C, and E fixtures that use synthetic text and test keys only.
3. Prototype a restricted Wasmtime or Wassette tool runner if time allows after the handoff works. Limit guest filesystem, network, and host calls by explicit permissions. Record a test showing the restriction. The local model runtime may stay outside this tool sandbox; state that boundary in the demo.
4. Write a short threat model beside the implementation: who controls the buyer, marketplace, seller host, and judge; what encryption protects in transit and storage; and which plaintext each host can still inspect. Do not call the prototype a confidential VM or claim remote attestation.

## Verify and hand off

Test correct decrypt, wrong-key failure, tamper failure, and buyer-authorized judge access. If you build the tool runner, test a denied filesystem or network action and a permitted action. Send B and C the API and fixture in `D-to-B.md` and `D-to-C.md`; send E the judge envelope path in `D-to-E.md`. Include commit, commands, and remaining trust limits in each handoff.
