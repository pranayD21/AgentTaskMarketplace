# Deploy the shared marketplace

Run these commands from the repository root. The cloud server uses Insforge and Stripe test mode. Seller inference and judging continue on the team’s computers.

## Publish to Manufact

```sh
pnpm install --frozen-lockfile
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js login
pnpm deploy:manufact --json
```

Login asks the human to approve a device code. `deploy:manufact` prepares `.env.manufact`, builds the server, and uploads the workspace source. The deployment ID means the build has started; it does not mean the endpoint is healthy yet.

The script uploads the repository root because the server depends on `workspace:*` packages. It sets explicit server-only build and start commands. The first managed upload used the default workspace-wide build and failed in the local Wasm toolchain; the subsequent deployment honored the saved command overrides and succeeded. Manufact uses its generated image when these commands are set, even if a Dockerfile is present. The root Dockerfile is an alternative for container deployments. CLI 4.4.1 does not accept `deploy --port`; the port belongs to the start command. The Mac-only Wasm build helper is optional so installing on Linux does not require a Mac binary.

`.env.manufact` is ignored by Git, has permissions 600, and contains an allowlist of server settings. It excludes the judge private key, Anthropic key, seller/buyer API keys, and local service URLs. `BASE_URL` is omitted so the server derives its public origin from Manufact’s `MCP_URL`. Do not pass the full developer `.env` to cloud deployment.

## Check the build and endpoint

```sh
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deployments get DEPLOYMENT_ID --json
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deployments logs DEPLOYMENT_ID --help
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js servers get SERVER_ID --json
curl -fsS https://YOUR-SERVER.run.mcp-use.com/api/health
MARKETPLACE_URL=https://YOUR-SERVER.run.mcp-use.com/mcp node scripts/buyer.mjs info
```

Use the endpoint returned by the deployment, then repeat the health and MCP discovery checks from a second computer. `/health` is the framework health response in production. `/api/health` should report contract `0.2`, `Insforge Postgres`, the intended payment mode, and the public `base_url`. Also call `marketplace_info` to exercise MCP discovery. Keep credentials in private configuration; never paste a buyer key into a coordination message.

## Current team endpoint

- MCP: https://warm-cloud-4hh5i.run.mcp-use.com/mcp
- Public task metadata: https://warm-cloud-4hh5i.run.mcp-use.com/api/dashboard
- Manufact server ID: `1cb4bcbc-3f2a-4ae3-8d7b-6c86aaa5624a`
- First successful deployment: `4df23d0c-9188-449e-9033-256c3b2fff2b`, 2026-10-18 02:37 UTC.
- Current deployment: `eaba52dd-79b3-4853-8988-2ba57132b53d`, running since 02:48:52 UTC. It includes `/api/health` and D's pinned MPP challenge follow-up. Application health passed at 02:51 UTC: contract 0.2, card mode, Insforge Postgres and the correct hosted origin. B independently verified hosted discovery and health from its computer.

The CLI-returned deployment was superseded by a webhook deployment of the same uploaded commit. If its status is `stopped`, inspect `servers get` for the newest deployment before treating the release as failed. Remote `marketplace_info` and `/api/dashboard` passed, and Armature discovered all 21 tools. C's seller and judge use this endpoint with 5000 ms polling.

## Connect local workers

Set `MARKETPLACE_URL` in each computer’s private environment to the hosted `/mcp` endpoint. Rebuild the component after runner changes, then run:

```sh
pnpm build:runner
pnpm daemon --role seller --runtime wassette --display-name computer-c-live --poll-ms 5000
# On the judge computer, with the judge credentials:
pnpm daemon --role judge --runtime wassette --poll-ms 5000
```

Each seller needs Ollama and an allowlisted model. Each computer should have its own seller identity. The judge holds the judge private key and Anthropic key. The server does not need either one.

## Dashboard

Manufact deploys the MCP server. Run the dashboard separately, pointing its public API setting at that server:

```sh
VITE_MARKETPLACE_BASE_URL=https://YOUR-SERVER.run.mcp-use.com pnpm --filter @atm/web dev
```

For a shared LAN dashboard, pass `--host 0.0.0.0` to Vite and use the LAN API origin. Browser requests contain no agent credentials. The dashboard shows task metadata, runner labels and test payment status; prompts and answers remain outside the public view.
