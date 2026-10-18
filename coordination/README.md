# Five-computer communication

Each computer has one letter: **A, B, C, D, E**. The 20 files in `coordination/messages/` are the team's message channels. `A-to-B.md` carries messages from A to B; B answers in `B-to-A.md`. Every computer has four outbound files (it writes them) and four inbound files (it reads them).

| sender | writes |
|---|---|
| A | `A-to-B.md`, `A-to-C.md`, `A-to-D.md`, `A-to-E.md` |
| B | `B-to-A.md`, `B-to-C.md`, `B-to-D.md`, `B-to-E.md` |
| C | `C-to-A.md`, `C-to-B.md`, `C-to-D.md`, `C-to-E.md` |
| D | `D-to-A.md`, `D-to-B.md`, `D-to-C.md`, `D-to-E.md` |
| E | `E-to-A.md`, `E-to-B.md`, `E-to-C.md`, `E-to-D.md` |

**Only the sender edits a file.** Never revise or delete an earlier entry; post a new entry that references it. Because each file has exactly one writer, two computers never edit the same file and Git never has a textual conflict here.

## Message format

Append at the end of the file. UTC timestamps. The ID is `<FROM>-<TO>-<YYYYMMDDTHHMMSSZ>-<NN>`; bump `NN` if you send two in the same second.

```md
## C-A-20261018T023000Z-01
- Sent (UTC): 2026-10-18T02:30:00Z
- Type: QUESTION
- Reply to: none
- Reference: `feat/c-seller` at `abc1234`, `packages/runner-wasm/src/component.ts`
- Needed by (UTC): 2026-10-18T03:00:00Z
- Message: claim_task needs optional runner_pubkey_b64 + runner_key_id so run-cycle can present a per-claim key. Proposed shape in docs/CONTRACT.md §7 item 1. OK to build against it?
```

`Type` is one of `QUESTION`, `ANSWER`, `BLOCKER`, `DECISION`, `HANDOFF`, `ACK`. One concrete request or result per entry. A reply uses a new ID in the reverse file with the original ID in `Reply to`. Acknowledge every `HANDOFF` and `BLOCKER` so the sender knows it was seen.

A `HANDOFF` always contains: branch, commit SHA, the exact run command, what it printed (trimmed, no secrets), and what is still missing.

## Where messages live and how to send

Messages are committed straight to `main`; code lives on your feature branch. From your checkout:

```sh
# read (do this when you start, every 10 minutes, and before a handoff)
git fetch origin main
git show origin/main:coordination/messages/A-to-C.md     # replace with each of your four inbound files

# send
git stash --include-untracked        # park uncommitted code if any
git switch main && git pull --rebase origin main
$EDITOR coordination/messages/C-to-A.md   # append one entry
git add coordination/messages/C-to-A.md
git commit -m "coord: C to A question on per-claim runner key"
git push origin HEAD:main            # if rejected: git pull --rebase origin main && git push origin HEAD:main
git switch feat/c-seller && git stash pop
```

Never force-push `main`. If a rebase ever reports a conflict in a message file, stop: two people wrote to the same file, which the single-writer rule forbids; contact the file's owner in person and keep both entries.

## Decisions and blockers

- Interface questions go to the owner of the interface (ownership table in `AGENTS.md`). Anything that changes a shared API, schema or state transition goes to **A**, who records the final shape in `docs/CONTRACT.md` and announces the `main` commit SHA to every affected computer.
- A message alone does not update your checkout. After A announces a contract commit, commit or stash your work and run `git fetch origin main && git merge origin/main` on your feature branch before using the new fields.
- If an urgent blocker has no answer after two 10-minute checks, post a `BLOCKER` to A and say it out loud to the room. A live conversation does not replace the Git record: write the decision down afterwards.
- Keep prompts, answers, API keys, private keys, ciphertext and Stripe secrets out of these files. Git history is forever.
