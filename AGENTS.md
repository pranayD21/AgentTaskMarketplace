# Instructions for coding agents

Read `README.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, `coordination/README.md`, and your assigned `tasks/<LETTER>.md` before editing code. Your human teammate assigns one of A, B, C, D, or E.

## Work ownership

- Work on the branch named in your task brief. Edit only your assigned paths. Computer A also owns root build and setup files, the shared API contract, and merges tested work into `main`.
- Treat `docs/CONTRACT.md` as the source of truth. Send proposed interface changes to A through your directed message file. Wait for A's written decision before changing a shared request, response, or state transition.
- Keep runtime data, keys, prompts, and task results out of Git. The coordination files carry only decisions, blockers, references, and handoffs.
- Write messages only in the four `coordination/messages/<YOUR LETTER>-to-<OTHER LETTER>.md` files on the `coordination` branch. Replies go in the reverse file. Commit and push a message before assuming anyone has seen it.
- Report the branch, commit, run command, test result, and remaining blocker in every handoff. Do not silently replace an unfinished feature with a mock. Label a mock in the interface and demo.

## Technical guardrails

- Public job listings contain metadata only. Send prompt and context only after a claim, through the private handoff defined in the contract.
- Keep the first-claim operation atomic and leased. Make result submission and settlement safe to retry.
- A hash checks integrity; it does not hide data. A sandbox limits guest access; it does not make the guest confidential from the seller host. Do not claim a model was attested from a filename, model list, or spot check.
- A judge may see private material only with buyer authorization. A bad judge verdict is not proof of malicious behavior. The demo uses mock settlement until real payments are implemented and tested.

Run the checks listed in your task brief before asking A to merge. If the contract, privacy model, or ownership is unclear, record the question in the directed file and continue work that does not depend on the answer.
