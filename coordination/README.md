# Five-computer communication

Each computer has one letter: A, B, C, D, or E. The 20 files in `coordination/messages/` are the team's message channels. `A-to-B.md` is for messages from A to B. There are four outbound files and four inbound files for each computer.

| Sender | Outbound files |
| --- | --- |
| A | `A-to-B.md`, `A-to-C.md`, `A-to-D.md`, `A-to-E.md` |
| B | `B-to-A.md`, `B-to-C.md`, `B-to-D.md`, `B-to-E.md` |
| C | `C-to-A.md`, `C-to-B.md`, `C-to-D.md`, `C-to-E.md` |
| D | `D-to-A.md`, `D-to-B.md`, `D-to-C.md`, `D-to-E.md` |
| E | `E-to-A.md`, `E-to-B.md`, `E-to-C.md`, `E-to-D.md` |

After the initial setup commit, only the sender edits a file. A writes `A-to-*`; B writes `B-to-*`; and so on. Reply in your own outbound file. For example, B answers a question in `A-to-B.md` by appending to `B-to-A.md`. Never revise or delete an earlier entry. Post a new entry that references it if you need to correct something.

## Message format

Append each message at the end of its file, below the previous entry. Use UTC timestamps and a unique ID. If you send two messages in the same second, increment the final number.

```md
## A-B-20261017T170000Z-01
- Sent (UTC): 2026-10-17T17:00:00Z
- Type: QUESTION
- Reply to: none
- Reference: `work/A-api` at `abc1234`, or `none`
- Needed by (UTC): 2026-10-17T17:30:00Z, or `none`
- Message: Can the claim response include the seller ID? I propose `sellerId`.
```

Use `QUESTION`, `ANSWER`, `BLOCKER`, `DECISION`, `HANDOFF`, or `ACK` as the type. A reply uses a new ID in the reverse file and puts the original ID in `Reply to`. Include a branch, commit, file path, or interface name when it helps the other computer act. Write one concrete request or result per entry. Acknowledge a handoff or blocker in the reverse file so the sender knows you saw it.

## Set up the shared branch

The shared `coordination` branch is created during project setup. Edits left on a computer's feature branch are invisible to the other computers. Keep a separate Git worktree for `coordination` and do coding in your normal checkout. On a fresh clone, run this once on each of the five computers:

```sh
git fetch origin
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

If your clone already has a local `coordination` branch, use `git worktree add ../AgentTaskMarketplace-coordination coordination` instead. Use the assigned feature branch in your normal checkout: A uses `work/A-api`, B uses `work/B-buyer`, C uses `work/C-seller`, D uses `work/D-security`, and E uses `work/E-judge`. Do not merge `coordination` into a feature branch. Everyone needs permission to push to the repository's `coordination` branch.

## Read and send

Check all four inbound files when you start, every 10 minutes during the hackathon, and before an integration handoff. This example shows A reading B's file without changing the worktree:

```sh
git fetch origin coordination
git show origin/coordination:coordination/messages/B-to-A.md
```

To send a message, work in the separate coordination worktree. This example sends from A to B:

```sh
cd ../AgentTaskMarketplace-coordination
git fetch origin coordination
git rebase origin/coordination
# Append one entry to coordination/messages/A-to-B.md.
git add coordination/messages/A-to-B.md
git commit -m "coord: A to B claim response question"
git push origin HEAD:coordination
```

If the push is rejected because another computer pushed first, keep your commit and retry:

```sh
git fetch origin coordination
git rebase origin/coordination
git push origin HEAD:coordination
```

Repeat the retry if the branch moves again. Do not force-push. If a rebase reports a conflict in a message file, stop, inspect the file, and contact its assigned writer before resolving it. Two computers should never be editing the same directed file.

## Decisions and blockers

Ask the owner of an interface through the matching file. B, C, D, and E send A a copy in their outbound file to A when a decision changes a shared API or blocks integration. A records the final shared contract in the project documentation. If an urgent blocker has no answer after two 10-minute checks, send A a `BLOCKER` message. Alert A in a live team call if one is available, then record the decision in the message file. A live conversation does not replace the Git record.

For a shared contract change, A first commits and merges the revised `docs/CONTRACT.md` and schema into `main`, then sends each affected computer a message with the `main` commit SHA and changed fields. A message alone does not update a feature checkout. After receiving it, commit or stash local edits and run `git fetch origin main` followed by `git merge origin/main` on your assigned `work/<LETTER>-...` branch. Resolve any conflict before using the new fields, then push your branch. Treat an unmerged proposal on A's branch as a proposal, not a new contract.

Keep real task prompts, private context, results, credentials, tokens, payment details, and personal data out of these files. Git history retains old entries, including entries later deleted from a branch. Use the application's task delivery channel for task payloads. Coordination messages should contain only safe references, interface details, and synthetic examples.
