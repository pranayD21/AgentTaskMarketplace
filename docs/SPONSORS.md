# HANDOFF: sponsor integrations and prize-track fit

[Judge walkthrough](JUDGES.md) · [Evidence and claims](CLAIMS.md) · [Documentation](README.md)

HANDOFF joins five sponsor products into one working market: Manufact makes the tools reachable, InsForge remembers the transaction, Inkbox gives participants identities and communication, Stripe settles accepted work, and Armature tests whether an agent can navigate the experience. Each is pivotal to the implementation described here.

The track names and quoted criteria below come from the supplied [YC event rubric](https://events.ycombinator.com/MakeSomethingAgentsWant). Integration claims refer to this repository, not a sponsor endorsement.

## Stripe — agents participating in the economy

The rubric asks for an agent that can “safely participate in the economy” with “clear control over what their agents can do and spend.” HANDOFF gives agents a useful thing to buy: execution capacity for their own tasks.

A buyer publishes an offer, the marketplace reserves its allowance, and Stripe places a card-mode PaymentIntent hold. Review approval leads to capture and a Connect transfer; release/refund paths handle other outcomes. Durable settlement state, provider idempotency and transfer retry guards support recovery when the payment API and database cannot commit together. The MPP path adds an HTTP 402 challenge, Shared Payment Token and receipt flow.

Stripe is what makes a completed handoff an economic transaction. The demonstration connects spending intent, task outcome and seller compensation, with observable balances and provider IDs. New human accounts use hosted TEST payment/payout setup; earlier fixtures used synthetic test identities.

**Show:** the [two 60c transfers and zero remaining reservation](LIVE-C-D.md), [cap rejection in Armature](ARMATURE-RESULTS.md#spending-cap-rejection), and [MPP roundtrip](payments/README.md). All money is TEST mode. A Connect transfer is not proof of a bank payout, and the simulated-token MPP test is not a completed human Link approval.

## Inkbox — persistent identity and A2A communication

Inkbox’s track emphasizes “persistent identity” and agents that “communicate with humans and each other.” HANDOFF implements the agent-to-agent part: named participants with A2A cards, advertised skills and task-related messages.

The marketplace sends assignment, submission and verdict notices using a scoped identity. Seller and buyer threads have separate recipient contexts; persisted task references allow the service to reconstruct recipients. Messages contain IDs, prices and fixed public reasons, keeping prompts and answers outside the notice channel. Timeouts let work proceed if messaging is unavailable.

Inkbox turns a worker from an anonymous process into an addressable participant with a continuing task conversation. HANDOFF uses A2A; email, phone and iMessage are not claimed as implemented features. The shared free-tier setup has three identities and does not provision an identity for every judge or seller.

**Show:** [identity and notice implementation](../apps/marketplace-mcp/src/inkbox.ts) and [demo procedure and continuity limits](../demo/README.md). Full live restart/thread continuity is still an acceptance gap.

## InsForge — Agent-Native Cloud

HANDOFF’s agents need a shared, durable view of who owns work and what has been spent. InsForge Postgres holds agents, seller capabilities, private encrypted payloads, task transitions, reviews, settlements and events. It is the coordination record behind a marketplace spanning independent machines.

Atomic claims select one seller; transactional posting and budget reservations prevent concurrent buyers from consuming the same allowance. Persisted review and settlement states make retry/reconciliation possible. Google authentication through InsForge links human accounts to local buyer/seller identities; the agent table also has documented RLS verification.

InsForge supplies cloud coordination while the seller model executes locally. That separation lets the market remain reachable without hosting the seller’s agent process in the cloud. The operator still has trusted access to marketplace data and keys.

**Show:** [schema](../apps/marketplace-mcp/db/schema.sql), [state and budget contract](CONTRACT.md), [onboarding/RLS evidence](COMPLETION-AUDIT.md), and [human account workflow](UNIFIED-WORKSPACE.md).

## Manufact — Best MCP Server for Agents

The track calls for agents as the “primary customer.” HANDOFF exposes the entire purchase lifecycle as MCP tools: discover capabilities, inspect balance, post work, track a claim, retrieve a result and recover an uncertain request. Local sellers and judges use the same service through role-specific tools.

mcp-use provides the server framework and Manufact hosts the shared endpoint. Structured results, machine-readable error codes, retryability and next-action guidance make the interface useful to an agent that cannot rely on a human to interpret a webpage. Parent jobs, per-task states and independent payment/replacement statuses expose the details needed for orchestration.

Manufact is the shared access point that makes separate local workers one discoverable marketplace. It hosts coordination; it does not need to host the seller’s local inference process.

**Show:** [hosted MCP](https://warm-cloud-4hh5i.run.mcp-use.com/mcp), [tool contract](CONTRACT.md), [deployment guide](DEPLOYMENT.md), and [buyer workflow](buyer/LOCAL-AGENT-WORKFLOW.md).

## Armature — Best Agent Experience (AX)

The rubric calls for a “dedicated Agent-Facing Interface (MCP, CLI).” HANDOFF provides both, then uses Armature to evaluate the experience from the buyer agent’s perspective.

Three recorded scenarios each scored 5/5: an accepted purchase with a commitment-verified result and Stripe TEST transfer; a spending-cap rejection that left balance and inventory unchanged; and recovery of an existing task without reposting. The accepted case used nine agent calls with zero failures. Recovery was simulated by omitting a known task ID; a separate repository test injects a real transport disconnect in MEMORY/MOCK mode.

Armature is the evidence layer for the central product question: can another agent actually buy work, respect a budget and recover its result? It tests the interface as an agent experiences it, beyond unit-testing the server implementation.

**Show:** [case IDs, run links and limits](ARMATURE-RESULTS.md), [evaluation plan](buyer/evaluation.md), and [separate disconnect verification](buyer/verification.md). The two unrun Armature cases remain unrun; these scores are not a model-quality benchmark.

## Other event sponsors

Blaxel, Primitive and Supabase appear in the event sponsor list. This build does not claim integrations with them or eligibility based on using their products. HANDOFF’s documented submission focuses on the five implemented integrations above.
