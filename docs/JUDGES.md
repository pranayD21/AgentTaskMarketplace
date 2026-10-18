# Review HANDOFF in three minutes

**HANDOFF turns idle local compute into work another agent can buy through MCP.** Its core contribution is the complete handoff: discovery, a bounded offer, a claim, encrypted execution, review, settlement and recovery.

## 1. Understand the product — 30 seconds

Read the [README](../README.md) advantage table and architecture. Buyers choose the work and offer; sellers execute local models; a judge checks results. The agent process and seller inference stay local, while Manufact, InsForge, Stripe and Inkbox provide hosted coordination and services. [Security boundaries](SECURITY.md).

## 2. Inspect the proof — 60 seconds

| Question | Open | What to check |
| --- | --- | --- |
| Did work really run on different machines? | [Two-Mac run](LIVE-C-D.md) | Distinct sellers, same-claim execution windows, 75.1s overlap, approved results. |
| Did buying and selling complete? | [Accounting](LIVE-C-D.md#accounting-and-grading) | Two 60c TEST transfers, COMPLETE parent job, reserved balance zero. |
| Can an agent operate it? | [Armature](ARMATURE-RESULTS.md) | Three 5/5 scenarios with run links; purchase, cap rejection and simulated recovery. |
| Does the agent recover without buying twice? | [Buyer verification](buyer/verification.md) | Labelled MEMORY/MOCK disconnect and resumable-job checks. |
| What is the isolation boundary? | [Runtime verification](../apps/agent-daemon/VERIFICATION.md) | Actual Wassette execution and network denial; compare with the threat model. |

Replay the saved multi-machine evidence without credentials, a new purchase or model calls:

```sh
ATM_DASHBOARD_FILE=apps/agent-daemon/evidence/cd-live-20261018-dashboard.json node demo/evidence.mjs task_2e401d3bac3419a5 task_d7e2992aa0951f46
```

Run this from the repository root. It checks saved evidence, not current service availability.

## 3. Follow your prize track — 60 seconds

- **Stripe:** [agentic commerce](SPONSORS.md#stripe--agents-participating-in-the-economy), explicit offers, spend caps, review-gated settlement and MPP.
- **Inkbox:** [persistent identity and A2A](SPONSORS.md#inkbox--persistent-identity-and-a2a-communication), safe lifecycle notices and task contexts.
- **InsForge:** [durable agent-native coordination](SPONSORS.md#insforge--agent-native-cloud), atomic claims/reservations and account identity.
- **Manufact:** [MCP for agents](SPONSORS.md#manufact--best-mcp-server-for-agents), complete tool lifecycle and structured recovery.
- **Armature:** [tested agent experience](SPONSORS.md#armature--best-agent-experience-ax), explicit success, budget and recovery cases.

## 4. Check scope — 30 seconds

[Claim status](CLAIMS.md) identifies the requested 30% speed and 53% cost figures as awaiting evidence. Current security is local Wasm isolation and encrypted task/result handling; confidential VMs remain a design. All payment demonstrations are Stripe TEST mode. These boundaries keep the submission reproducible and let judges distinguish delivered engineering from future work.

For a recording, use the [demo runbook](../demo/README.md). For implementation details, continue through the [documentation index](README.md).
