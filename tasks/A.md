# Computer A: marketplace API and integration

You are Computer A. This is your complete starting brief: follow the setup and reading steps here, then build, test, commit, push, and send a handoff. The human only needs to assign you this letter and give you repository write access.

## Project and setup

The hackathon demo is a marketplace for agent tasks on spare local compute. A buyer publishes metadata without a prompt, an eligible seller claims the job, the buyer sends encrypted task data, a local Ollama model produces a result, and a consented judge records a verdict before mock credits are settled. Real confidential inference, model attestation, live payments, and on-chain records are outside the first demo unless separately implemented and verified.

Repository: `https://github.com/pranayD21/AgentTaskMarketplace`. On a fresh computer, run:

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/A-api
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If the repository is already cloned, fetch from `origin`, switch to `work/A-api`, and create the coordination worktree only if it does not exist. Do coding in `work/A-api` and use the second checkout only for messages. Do not merge `coordination` into your code branch.

Before coding, read `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md`. `docs/CONTRACT.md` is the exact v0.1 API and data contract; use its field names and state transitions. Computer A owns contract changes. Work only in your owned paths and ask the relevant owner before depending on an unmerged interface change.

## Communication and handoff

Your four outbound files are `A-to-B.md`, `A-to-C.md`, `A-to-D.md`, `A-to-E.md`. Your inbound files are `B-to-A.md`, `C-to-A.md`, `D-to-A.md`, `E-to-A.md`. Only you edit your outbound files. To contact B, append a dated entry to `coordination/messages/A-to-B.md` in the coordination worktree; B replies in `B-to-A.md`. Each entry needs a unique ID, type, concrete message, and optional reply-to ID, as shown in `coordination/README.md`.

Fetch `origin/coordination` before reading incoming messages, at the start of work, roughly every 10 minutes, and before handoff. Commit and push each outgoing message to `coordination`; a local edit is not delivered. If a push loses a race, fetch, rebase the coordination worktree onto `origin/coordination`, and retry without force-pushing. Keep prompts, results, credentials, keys, and payment details out of Git.

Read an incoming file from your code checkout with `git fetch origin coordination` and `git show origin/coordination:coordination/messages/B-to-A.md`. To send, use this pattern in the coordination worktree:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append a new entry to coordination/messages/A-to-B.md.
git add coordination/messages/A-to-B.md
git commit -m "coord: A to B handoff"
git push origin HEAD:coordination
```

Use a heading such as `## A-B-YYYYMMDDTHHMMSSZ-01`, then record `Sent (UTC)`, `Type`, `Reply to`, `Reference` (branch and commit), `Needed by (UTC)`, and one concrete `Message`. For another recipient, replace `B` in the filename and ID. A recipient answers in its reverse file. Never edit another computer's file or revise an old entry; correct a mistake with a new entry. If a push is rejected, repeat the fetch, rebase, and push steps.

For a shared contract change, commit and merge the revised contract and schemas into `main` first, then send B, C, D, and E the `main` commit SHA and changed fields. Merge `origin/main` back into `work/A-api` before continuing API work. At handoff, push `work/A-api` and send each affected owner your commit SHA, run command, test result, remaining blocker, and any interface change through your outbound file.

## Assignment

You own `apps/api/`, `packages/contracts/`, the shared contract and project docs, root build and setup files, and integration into `main`.

## Build

1. Publish versioned JSON examples and request/response schemas from `docs/CONTRACT.md` in `packages/contracts/`. Send the contract checkpoint to B, C, D, and E through `coordination/messages/A-to-*.md` before changing shared interfaces.
2. Build the FastAPI service in `apps/api/` with SQLite persistence. Implement seller registration, public job creation and listing, eligibility checks, one atomic claim with a lease, private encrypted payload relay after a claim, result submission, and status lookup. Implement the judge and mock settlement hooks specified in the contract, leaving verdict policy to E.
3. Enforce the job state machine. Reject private payload upload before a valid claim. Never put prompt or context in public responses or normal logs. Use request IDs or idempotency keys where the contract requires them. Handle expired claims so an abandoned job can be retried.
4. Give B, C, D, and E a running API address, OpenAPI page, example fixture, and test credentials or local setup instructions that use synthetic data. Keep shared setup changes in your branch and announce them before merge.

## Verify and hand off

Test that two sellers racing to claim one job produce exactly one winner; an expired lease can be recovered; repeated submission does not duplicate a result or payment event; and public responses omit private task text. Send each owner the endpoint and fixture they need. For each merge, run the end-to-end demo with E, record the passing command and commit, and keep `main` runnable. If another owner needs a contract change, decide it in the directed message files and update the contract before asking them to adapt.
