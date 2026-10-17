# Computer C: seller worker and local model runtime

You are Computer C. This is your complete starting brief: follow the setup and reading steps here, then build, test, commit, push, and send a handoff. The human only needs to assign you this letter and give you repository write access.

## Project and setup

The hackathon demo is a marketplace for agent tasks on spare local compute. A buyer publishes metadata without a prompt, an eligible seller claims the job, the buyer sends encrypted task data, a local Ollama model produces a result, and a consented judge records a verdict before mock credits are settled. Real confidential inference, model attestation, live payments, and on-chain records are outside the first demo unless separately implemented and verified.

Repository: `https://github.com/pranayD21/AgentTaskMarketplace`. On a fresh computer, run:

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/C-seller
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If the repository is already cloned, fetch from `origin`, switch to `work/C-seller`, and create the coordination worktree only if it does not exist. Do coding in `work/C-seller` and use the second checkout only for messages. Do not merge `coordination` into your code branch.

Before coding, read `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md`. `docs/CONTRACT.md` is the exact v0.1 API and data contract; use its field names and state transitions. Computer A owns contract changes. Work only in your owned paths and ask the relevant owner before depending on an unmerged interface change.

## Communication and handoff

Your four outbound files are `C-to-A.md`, `C-to-B.md`, `C-to-D.md`, `C-to-E.md`. Your inbound files are `A-to-C.md`, `B-to-C.md`, `D-to-C.md`, `E-to-C.md`. Only you edit your outbound files. To contact A, append a dated entry to `coordination/messages/C-to-A.md` in the coordination worktree; A replies in `A-to-C.md`. Each entry needs a unique ID, type, concrete message, and optional reply-to ID, as shown in `coordination/README.md`.

Fetch `origin/coordination` before reading incoming messages, at the start of work, roughly every 10 minutes, and before handoff. Commit and push each outgoing message to `coordination`; a local edit is not delivered. If a push loses a race, fetch, rebase the coordination worktree onto `origin/coordination`, and retry without force-pushing. Keep prompts, results, credentials, keys, and payment details out of Git.

Read an incoming file from your code checkout with `git fetch origin coordination` and `git show origin/coordination:coordination/messages/A-to-C.md`. To send, use this pattern in the coordination worktree:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append a new entry to coordination/messages/C-to-A.md.
git add coordination/messages/C-to-A.md
git commit -m "coord: C to A handoff"
git push origin HEAD:coordination
```

Use a heading such as `## C-A-YYYYMMDDTHHMMSSZ-01`, then record `Sent (UTC)`, `Type`, `Reply to`, `Reference` (branch and commit), `Needed by (UTC)`, and one concrete `Message`. For another recipient, replace `A` in the filename and ID. A recipient answers in its reverse file. Never edit another computer's file or revise an old entry; correct a mistake with a new entry. If a push is rejected, repeat the fetch, rebase, and push steps.

When A announces a new contract commit on `main`, commit or stash your work, run `git fetch origin main` and `git merge origin/main` on `work/C-seller`, then continue against the merged contract. Treat an unmerged proposal as a proposal. At handoff, push `work/C-seller` and send A your commit SHA, run command, test result, remaining blocker, and any interface change through `C-to-A.md`.

## Assignment

You own `apps/seller/`.

## Build

1. Build a seller process that queries the local Ollama API for installed models, registers its available model IDs and public key, and claims only jobs compatible with its actual local configuration. Report a model name or digest as a local observation, not proof of model identity.
2. Poll or subscribe to available jobs. Claim through A's atomic endpoint, maintain the lease while working, and recover cleanly when a claim expires or another seller wins. Do not download a model without an explicit seller setting.
3. Fetch the private payload only after winning a claim. Use D's handoff package to decrypt it locally. Call the selected installed model through Ollama, enforce a timeout, and submit the same result plaintext in separate buyer and judge envelopes with the contract's result commitment. Keep prompts, context, and outputs out of routine logs and Git.
4. Make the seller process runnable with one documented command, an example local configuration, and a synthetic task fixture. If D's optional isolated tool runner is available, integrate it behind an explicit setting and state what it isolates.

## Verify and hand off

Demonstrate one successful local inference, a model mismatch that prevents claiming, a lost race with another seller, and a safe retry after a network interruption. Show the Ollama model used and its self-reported digest without calling it attestation. Send A the branch, commit, run command, test results, and blockers in `C-to-A.md`; send D integration questions in `C-to-D.md`.
