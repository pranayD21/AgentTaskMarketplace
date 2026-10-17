# Agent Task Marketplace

This repository is the starting plan for a hackathon demo of an agent labor market. A buyer agent lists a task without publishing its prompt, an eligible seller claims it and runs a local model, and a judge checks the result before a mock payment is released. The product code has not been built yet.

Five computers can build in parallel from the same contract:

| Computer | Branch | Owner | Main paths |
| --- | --- | --- | --- |
| A | `work/A-api` | Marketplace API, shared contract, integration | `apps/api/`, `packages/contracts/`, `docs/CONTRACT.md` |
| B | `work/B-buyer` | Buyer client, web interface, MCP entry point | `apps/buyer/`, `apps/web/` |
| C | `work/C-seller` | Seller worker and local model adapter | `apps/seller/` |
| D | `work/D-security` | Encrypted handoff and execution isolation prototype | `packages/security/`, `apps/runner/` |
| E | `work/E-judge` | Judge, reputation, mock payments, end-to-end demo | `apps/judge/`, `apps/payments/`, `tests/e2e/`, `demo/` |

Read [the project plan](docs/PROJECT.md) and [the API contract](docs/CONTRACT.md) before writing code. [Security and demo claims](docs/SECURITY_AND_CLAIMS.md) explains what the prototype can prove. Each computer has a task brief in [`tasks/`](tasks/). Use the [coordination protocol](coordination/README.md) and the 20 directed message files in [`coordination/messages/`](coordination/messages/) to exchange decisions and handoffs.

## Start on each computer

Clone the repository, then check out your assigned branch. This example is for A; B through E use the branch shown in the table above and in their task brief.

```sh
git clone https://github.com/pranayD21/AgentTaskMarketplace.git
cd AgentTaskMarketplace
git switch --track origin/work/A-api
git worktree add -b coordination ../AgentTaskMarketplace-coordination origin/coordination
```

Read your task brief, work in the first checkout, and use the second checkout only for directed messages. All five computers need push access to the repository. The coordination guide explains how to read, reply, and recover from a simultaneous push.

The demo target is one complete local-compute run: publish metadata, claim a job, hand off a private payload, run an installed model, return a result, judge it, and update mock payment and seller state. The plan keeps real confidential execution, cryptographic model attestation, live payments, and on-chain records as later work unless the team implements and verifies them.
