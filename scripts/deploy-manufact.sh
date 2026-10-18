#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/prepare-manufact-env.mjs
pnpm install --frozen-lockfile
pnpm --filter @atm/web build:hosted
node scripts/prepare-seller-release.mjs
pnpm --filter @atm/marketplace-mcp build
# Upload only tracked source plus explicitly selected release files. The managed
# Git repository must retain the release, so omit its local-only ignore file.
ATM_DEPLOY_DIR="$(mktemp -d /tmp/atm-managed-deploy-XXXXXXXX)"
trap 'rm -rf "$ATM_DEPLOY_DIR"' EXIT
git archive HEAD | tar -x -C "$ATM_DEPLOY_DIR"
cp -R apps/marketplace-mcp/public/seller/. "$ATM_DEPLOY_DIR/apps/marketplace-mcp/public/seller/"
rm -f "$ATM_DEPLOY_DIR/apps/marketplace-mcp/public/seller/.gitignore"
cp .env.manufact "$ATM_DEPLOY_DIR/.env.manufact"
chmod 600 "$ATM_DEPLOY_DIR/.env.manufact"
mkdir -p "$ATM_DEPLOY_DIR/.mcp-use/cloud"
cp .mcp-use/cloud/link.json "$ATM_DEPLOY_DIR/.mcp-use/cloud/link.json"
node scripts/verify-seller-release.mjs
node apps/marketplace-mcp/node_modules/mcp-use/dist/bin.js deploy "$ATM_DEPLOY_DIR" \
  --no-github --yes --name agent-task-marketplace --env-file .env.manufact \
  --build-command 'corepack pnpm install --frozen-lockfile && node scripts/verify-seller-release.mjs && corepack pnpm --filter @atm/web build:hosted && corepack pnpm --filter @atm/marketplace-mcp build' \
  --start-command 'corepack pnpm --filter @atm/marketplace-mcp start --host 0.0.0.0 --port 3000' \
  "$@"
