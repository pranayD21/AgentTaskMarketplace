# Computer E: judge, reputation, mock payments, and demo

You are Computer E. This is your complete starting brief: follow the setup and reading steps here, then build, test, commit, push, and send a handoff. The human only needs to assign you this letter and give you repository write access.

## Project and setup

The hackathon demo is a marketplace for agent tasks on spare local compute. A buyer publishes metadata without a prompt, an eligible seller claims the job, the buyer sends encrypted task data, a local Ollama model produces a result, and a consented judge records a verdict before mock credits are settled. Real confidential inference, model attestation, live payments, and on-chain records are outside the first demo unless separately implemented and verified.

Repository: `https://github.com/pranayD21/AgentTaskMarketplace`. On a fresh computer, run:

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/E-judge
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If the repository is already cloned, fetch from `origin`, switch to `work/E-judge`, and create the coordination worktree only if it does not exist. Do coding in `work/E-judge` and use the second checkout only for messages. Do not merge `coordination` into your code branch.

Before coding, read `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md`. `docs/CONTRACT.md` is the exact v0.1 API and data contract; use its field names and state transitions. Computer A owns contract changes. Work only in your owned paths and ask the relevant owner before depending on an unmerged interface change.

## Communication and handoff

Your four outbound files are `E-to-A.md`, `E-to-B.md`, `E-to-C.md`, `E-to-D.md`. Your inbound files are `A-to-E.md`, `B-to-E.md`, `C-to-E.md`, `D-to-E.md`. Only you edit your outbound files. To contact A, append a dated entry to `coordination/messages/E-to-A.md` in the coordination worktree; A replies in `A-to-E.md`. Each entry needs a unique ID, type, concrete message, and optional reply-to ID, as shown in `coordination/README.md`.

Fetch `origin/coordination` before reading incoming messages, at the start of work, roughly every 10 minutes, and before handoff. Commit and push each outgoing message to `coordination`; a local edit is not delivered. If a push loses a race, fetch, rebase the coordination worktree onto `origin/coordination`, and retry without force-pushing. Keep prompts, results, credentials, keys, and payment details out of Git.

Read an incoming file from your code checkout with `git fetch origin coordination` and `git show origin/coordination:coordination/messages/A-to-E.md`. To send, use this pattern in the coordination worktree:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append a new entry to coordination/messages/E-to-A.md.
git add coordination/messages/E-to-A.md
git commit -m "coord: E to A handoff"
git push origin HEAD:coordination
```

Use a heading such as `## E-A-YYYYMMDDTHHMMSSZ-01`, then record `Sent (UTC)`, `Type`, `Reply to`, `Reference` (branch and commit), `Needed by (UTC)`, and one concrete `Message`. For another recipient, replace `A` in the filename and ID. A recipient answers in its reverse file. Never edit another computer's file or revise an old entry; correct a mistake with a new entry. If a push is rejected, repeat the fetch, rebase, and push steps.

When A announces a new contract commit on `main`, commit or stash your work, run `git fetch origin main` and `git merge origin/main` on `work/E-judge`, then continue against the merged contract. Treat an unmerged proposal as a proposal. At handoff, push `work/E-judge` and send A your commit SHA, run command, test result, remaining blocker, and any interface change through `E-to-A.md`.

## Assignment

You own `apps/judge/`, `apps/payments/`, `tests/e2e/`, and `demo/`.

## Build

1. Build a judge worker that receives a task only when the buyer has opted in and supplied the judge envelope. Verify the result commitment before judging, then evaluate a synthetic task against a buyer-provided rubric or tests. Store the verdict, reason, and evidence reference. Make the demo review rate 100% so both accepted and rejected outcomes are repeatable; keep random sampling as a configurable later step.
2. Define the failure path. A rejected seller result does not earn a mock payout. Return an actual judge-produced replacement answer only if your worker ran the replacement; otherwise show a failed terminal job and let the buyer create a new one. Record a low-quality result separately from a confirmed malicious act. Apply a visible, reversible seller suspension only to the latter.
3. Build a mock payment ledger that reserves the maximum price at task creation, credits the seller's locked claim price and refunds the difference after approval, and refunds the full reserve after rejection or final expiry. Keep settlement idempotent. Label every balance and payment screen as simulated. Add x402 or on-chain settlement only after the full mock flow works and real transaction evidence can be shown.
4. Write an end-to-end demo script and a short operator guide. Use non-sensitive prompts. Include an accepted case, a rejected case, a seller timeout, and the visible state and mock balance after each.

## Verify and hand off

Run the demo with A's API, B's buyer, C's seller, and D's handoff. Check that private content reaches the judge only with consent, duplicate verdicts do not pay twice, and a rejection records its reason. Send A the branch, commit, demo command, outcomes, and blockers in `E-to-A.md`. Ask every owner to acknowledge their integration handoff before the final demo.
