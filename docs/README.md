# HANDOFF documentation

Start with the [product README](../README.md), [judge walkthrough](JUDGES.md), [sponsor/track guide](SPONSORS.md) and [evidence/claim status](CLAIMS.md).

## Product and usage

- [Local workspace: chat, buying, selling and account controls](UNIFIED-WORKSPACE.md)
- [Local agent workflow and tool use](buyer/LOCAL-AGENT-WORKFLOW.md)
- [Seller installation and operation](../apps/agent-daemon/README.md)
- [Dashboard](../apps/dashboard/README.md) and [public web app](../apps/web/README.md)
- [Claude Code buyer](buyer/claude-code.md), [Codex buyer](buyer/codex.md), [parent jobs](buyer/jobs.md)
- [Demo runbook](../demo/README.md)

## Architecture and operations

- [MCP contract, schemas and state machine](CONTRACT.md)
- [Security and trust boundaries](SECURITY.md)
- [Manufact deployment](DEPLOYMENT.md)
- [Stripe payments and MPP](payments/README.md)
- [Google-only enrollment rollout](GOOGLE-ONLY-ROLLOUT.md)
- [Runner core](../packages/runner-core/README.md), [local runtime](../apps/agent-daemon/README.md), [measurements](../apps/agent-daemon/MEASUREMENTS.md)
- [Confidential-compute design — future architecture](X1-CONFIDENTIAL-COMPUTE.md)

## Evidence and measurement

- [Two physical machines, concurrent execution and settlement](LIVE-C-D.md)
- [Armature workflow results](ARMATURE-RESULTS.md), [evaluation plan](buyer/evaluation.md)
- [Buyer verification](buyer/verification.md), [Wassette verification](../apps/agent-daemon/VERIFICATION.md)
- [Bounded benchmark report](buyer/benchmark-report.md) and [protocol](buyer/benchmark-plan.md)
- [Autonomous benchmark — deferred](AUTONOMOUS-BENCHMARK.md)
- [Cost accounting](payments/COST.md) and [payment evidence](payments/evidence/README.md)

## Build history

[Progress](PROGRESS.md), [completion audit](COMPLETION-AUDIT.md), [original plan](PLAN.md), [branch integration](BRANCH-INTEGRATION.md), `tasks/` and `coordination/` retain dated build history. Earlier owner assignments, deployment revisions, test counts and open-work lists describe those snapshots. Use [AGENTS.md](../AGENTS.md) for current contributor instructions and inspect deployment health for the running revision.
