# Computer B: buyer client, web interface, and MCP entry point

You own `apps/buyer/` and `apps/web/`. Work on `work/B-buyer`. Read the root `AGENTS.md`, `docs/PROJECT.md`, `docs/CONTRACT.md`, `docs/SECURITY_AND_CLAIMS.md`, and `coordination/README.md` before coding. Ask A about contract changes in `coordination/messages/B-to-A.md`.

## Build

1. Build a buyer client that creates a public listing from allowed model IDs, budget, expiry, and a buyer public key. Keep the prompt, context, test data, and judge rubric on the buyer computer until the job is claimed. Show the seller match and state changes.
2. Before posting, ask the buyer for judge consent. The judged v0.1 flow requires consent; if declined, keep the draft local and explain that submission is unavailable. After a valid claim, use D's handoff package to encrypt and upload the chosen private payload to the claimed seller and a separate judge envelope. Decrypt the returned result on the buyer computer and show the verdict and mock payment state.
3. Build a small web interface for the demo. It must show which fields are public, when the private payload is sent, the allowed models, the selected seller, the result, and whether payment is simulated. A form may collect a prompt early, but it must stay local until the claim step.
4. Expose the buyer workflow to an agent through a local MCP server using Manufact's Python `mcp-use` SDK. Keep model inference on seller machines. Record the exact MCP tools and a working agent call in the handoff. If a tested SDK issue blocks this, report the issue to A and keep the buyer client working; do not present MCP as complete.

## Verify and hand off

Check the browser/API traffic and service logs with a synthetic task: no prompt or context may appear in the public listing before claim. Show a successful buyer run against A's API and C's seller. Demonstrate result decryption, verification of the result commitment, and that declining judge consent blocks submission in v0.1. Send A the branch, commit, run steps, MCP tool names, and any contract blocker through `B-to-A.md`; send D any handoff API issue through `B-to-D.md`.
