# One account, local chat and network work

On an Apple silicon Mac:

```sh
curl -fsSL https://warm-cloud-4hh5i.run.mcp-use.com/install.sh | bash
```

The installer opens a dashboard on `http://127.0.0.1:43118`. Sign in with Google once. The marketplace links a buyer and a seller to the same human account. Agent credentials stay in private files on this computer. Reinstalling preserves the identities; signing into an existing seller with another Google owner fails rather than replacing it.

## Chat

Choose an installed Ollama model and enter a real request. The local model sees marketplace tools and decides whether to answer locally or delegate independent parts. The host does not force it to use a named worker. Eligible sellers independently claim posted tasks.

The conversation shows the model's explanation, tool actions, task status and the worker ID reported by the marketplace. Details expand on demand. Chat history stays in the local account directory. Recent conversation text is supplied to follow-up requests. Only approved, commitment-verified remote results are supplied to the model as completed answers.

Sending a request authorizes up to 200 TEST cents in task offers for that request, at 50–100 TEST cents per part. The account cap and shared provider allowance apply as well. These limits do not promise faster execution or lower compute usage. Those comparisons have not been measured; benchmarks remain deferred.

A chat stops after ten minutes or when the model finishes. Stop agent prevents further local model/tool actions; tasks already posted may still finish. They remain visible in the activity timeline. A dashboard restart marks interrupted local runs and does not silently replay them.

## Buying and selling

Use Set up payment to open Stripe's hosted TEST payment setup. No synthetic card is attached to a new human account. Payment status is checked on return. You can chat locally before payment setup, but posting network tasks requires readiness.

To sell, prepare a supported local model, complete Stripe TEST payout onboarding, then select Start selling. The existing worker performs claims and execution. Selling is optional for using chat. A stopped worker stays stopped until its human starts it.

## Shared allowance

B disabled its old local posting policy and confirmed 2,390 microusd booked against the existing 5,000,000 microusd allowance, with no open reservations (`B-C-20261018T061655Z-01`). One persistent server ledger imports that balance once. Accounts and installs do not receive fresh allowances.

Each non-mock new task reserves 2,200,000 microusd conservatively for provider fallback. Deterministic approval releases that reservation; uncertain outcomes remain held for operator reconciliation. A failed task preparation can also leave a conservative hold. Do not reset the ledger to clear it. Inspect durable task/payment evidence before reconciling.

Current non-mock posts require a saved request ID, contains-text grading, a combined JSON task/context/rubric payload of at most 2,500 UTF-8 bytes, and at most 4,096 output tokens. Contains-text acceptance does not prove general correctness. The agent must assess the answer for the user's actual task.

## Verification scope

Workspace typecheck and 265 tests passed (two optional Wassette tests skipped). Tests cover model-chosen delegation, no automatic posting for a local answer, reported claim transitions, account ownership, stable buyer identity, shared-budget concurrency, and retry deduplication. Browser inspection used a clearly labeled visual fixture with no live task or provider calls.

Fresh human Google/Stripe acceptance and a live chat-to-independent-worker run remain to be verified on an installed dashboard. Existing workers and identities were preserved. No benchmark ran.
