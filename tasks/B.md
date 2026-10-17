# Computer B: buyer client, web interface, and MCP entry point

You are Computer B. This is your complete starting brief: follow the setup and reading steps here, then build, test, commit, push, and send a handoff. The human only needs to assign you this letter and give you repository write access.

## Project and setup

The hackathon demo is a marketplace for agent tasks on spare local compute. A buyer publishes metadata without a prompt, an eligible seller claims the job, the buyer sends encrypted task data, a local Ollama model produces a result, and a consented judge records a verdict before mock credits are settled. Real confidential inference, model attestation, live payments, and on-chain records are outside the first demo unless separately implemented and verified.

Repository: `https://github.com/pranayD21/AgentTaskMarketplace`. On a fresh computer, run:

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/B-buyer
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If the repository is already cloned, fetch from `origin`, switch to `work/B-buyer`, and create the coordination worktree only if it does not exist. Do coding in `work/B-buyer` and use the second checkout only for messages. Do not merge `coordination` into your code branch.

Before coding, read `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md`. `docs/CONTRACT.md` is the exact v0.1 API and data contract; use its field names and state transitions. Computer A owns contract changes. Work only in your owned paths and ask the relevant owner before depending on an unmerged interface change.

## Communication and handoff

Your four outbound files are `B-to-A.md`, `B-to-C.md`, `B-to-D.md`, `B-to-E.md`. Your inbound files are `A-to-B.md`, `C-to-B.md`, `D-to-B.md`, `E-to-B.md`. Only you edit your outbound files. To contact A, append a dated entry to `coordination/messages/B-to-A.md` in the coordination worktree; A replies in `A-to-B.md`. Each entry needs a unique ID, type, concrete message, and optional reply-to ID, as shown in `coordination/README.md`.

Fetch `origin/coordination` before reading incoming messages, at the start of work, roughly every 10 minutes, and before handoff. Commit and push each outgoing message to `coordination`; a local edit is not delivered. If a push loses a race, fetch, rebase the coordination worktree onto `origin/coordination`, and retry without force-pushing. Keep prompts, results, credentials, keys, and payment details out of Git.

Read an incoming file from your code checkout with `git fetch origin coordination` and `git show origin/coordination:coordination/messages/A-to-B.md`. To send, use this pattern in the coordination worktree:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append a new entry to coordination/messages/B-to-A.md.
git add coordination/messages/B-to-A.md
git commit -m "coord: B to A handoff"
git push origin HEAD:coordination
```

Use a heading such as `## B-A-YYYYMMDDTHHMMSSZ-01`, then record `Sent (UTC)`, `Type`, `Reply to`, `Reference` (branch and commit), `Needed by (UTC)`, and one concrete `Message`. For another recipient, replace `A` in the filename and ID. A recipient answers in its reverse file. Never edit another computer's file or revise an old entry; correct a mistake with a new entry. If a push is rejected, repeat the fetch, rebase, and push steps.

When A announces a new contract commit on `main`, commit or stash your work, run `git fetch origin main` and `git merge origin/main` on `work/B-buyer`, then continue against the merged contract. Treat an unmerged proposal as a proposal. At handoff, push `work/B-buyer` and send A your commit SHA, run command, test result, remaining blocker, and any interface change through `B-to-A.md`.

## Assignment

You own `apps/buyer/` and `apps/web/`.

## Build

1. Build a buyer client that creates a public listing from allowed model IDs, budget, expiry, and a buyer public key. Keep the prompt, context, test data, and judge rubric on the buyer computer until the job is claimed. Show the seller match and state changes.
2. Before posting, ask the buyer for judge consent. The judged v0.1 flow requires consent; if declined, keep the draft local and explain that submission is unavailable. After a valid claim, use D's handoff package to encrypt and upload the chosen private payload to the claimed seller and a separate judge envelope. Decrypt the returned result on the buyer computer and show the verdict and mock payment state.
3. Build a small web interface for the demo. It must show which fields are public, when the private payload is sent, the allowed models, the selected seller, the result, and whether payment is simulated. A form may collect a prompt early, but it must stay local until the claim step.
4. Expose the buyer workflow to an agent through a local MCP server using Manufact's Python `mcp-use` SDK. Keep model inference on seller machines. Record the exact MCP tools and a working agent call in the handoff. If a tested SDK issue blocks this, report the issue to A and keep the buyer client working; do not present MCP as complete.

## Verify and hand off

Check the browser/API traffic and service logs with a synthetic task: no prompt or context may appear in the public listing before claim. Show a successful buyer run against A's API and C's seller. Demonstrate result decryption, verification of the result commitment, and that declining judge consent blocks submission in v0.1. Send A the branch, commit, run steps, MCP tool names, and any contract blocker through `B-to-A.md`; send D any handoff API issue through `B-to-D.md`.
