# Deploy the shared marketplace

Run these commands from the repository root. The cloud server uses Insforge and Stripe test mode. Seller inference and judging continue on the team’s computers.

## Publish to Manufact

```sh
pnpm install --frozen-lockfile
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js login
pnpm deploy:manufact --json
```

Login asks the human to approve a device code. `deploy:manufact` prepares `.env.manufact`, builds the server, and uploads the workspace source. The deployment ID means the build has started; it does not mean the endpoint is healthy yet.

The script uploads the repository root because the server depends on `workspace:*` packages. It sets explicit server-only build and start commands. Manufact uses its generated image when these commands are set, even if a Dockerfile is present. The root Dockerfile is an alternative for container deployments. The port belongs to the start command. The Mac-only Wasm build helper is optional so installing on Linux does not require a Mac binary.

`.env.manufact` is ignored by Git, has permissions 600, and contains an allowlist of server settings. It excludes the judge private key, Anthropic key, seller/buyer API keys, and local service URLs. `BASE_URL` is omitted so the server derives its public origin from Manufact’s `MCP_URL`. Do not pass the full developer `.env` to cloud deployment.

## Check the build and endpoint

```sh
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deployments get DEPLOYMENT_ID --json
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deployments logs DEPLOYMENT_ID --help
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js servers get SERVER_ID --json
curl -fsS https://YOUR-SERVER.run.mcp-use.com/api/health
MARKETPLACE_URL=https://YOUR-SERVER.run.mcp-use.com/mcp node scripts/buyer.mjs info
```

Use the endpoint returned by the deployment, then repeat the health and MCP discovery checks from a second computer. `/health` is the framework health response in production. `/api/health` should report contract `0.3`, `pricing: task_offer`, `Insforge Postgres`, the intended payment mode, the public `base_url`, and the uploaded source revision. `prepare-manufact-env.mjs` sets `ATM_BUILD_REVISION` from Git; compare it with `/api/health.revision` before a rehearsal. Also call `marketplace_info` to exercise MCP discovery. Keep credentials in private configuration; never paste a buyer key into a coordination message.

## Current team endpoint

- MCP: https://warm-cloud-4hh5i.run.mcp-use.com/mcp
- Public task metadata: https://warm-cloud-4hh5i.run.mcp-use.com/api/dashboard
- Manufact server ID: `1cb4bcbc-3f2a-4ae3-8d7b-6c86aaa5624a`

Use `servers get` to identify the latest deployment and compare its revision with `/api/health.revision` before a demo. Sellers and judges can poll the endpoint with a 5000 ms interval.

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
