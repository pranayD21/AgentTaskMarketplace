#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/prepare-manufact-env.mjs
pnpm install --frozen-lockfile
pnpm --filter @atm/marketplace-mcp build
# Upload the workspace root so workspace:* packages resolve in the cloud.
# Keep both commands rooted here rather than inside apps/marketplace-mcp.
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deploy "$PWD" \
  --no-github --yes --name agent-task-marketplace --env-file .env.manufact \
  --build-command 'corepack pnpm install --frozen-lockfile && corepack pnpm --filter @atm/marketplace-mcp build' \
  --start-command 'corepack pnpm --filter @atm/marketplace-mcp start --host 0.0.0.0 --port 3000' \
  "$@"
