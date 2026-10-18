#!/usr/bin/env bash
# Demo driver. Each step is one subcommand so it can run in its own terminal
# pane; demo/README.md says what the audience should see at each step.
#
#   bash demo/run.sh check            # preflight: env, ollama, wassette, runner.wasm, server
#   bash demo/run.sh fresh            # new buyer + seller identities (frees Inkbox slots first)
#   bash demo/run.sh server           # local marketplace (skip when using the hosted URL)
#   bash demo/run.sh seller           # seller daemon (SELLER_RUNTIME=wassette|node, default wassette)
#   bash demo/run.sh judge            # judge daemon inside Wassette (judge-cycle)
#   bash demo/run.sh happy            # buyer posts a task that should be APPROVED
#   bash demo/run.sh reject           # buyer posts a task the small model will fail → REJECT
#   bash demo/run.sh result <task_id> # buyer reads the answer (commitment_verified, replacement_answer)
#   bash demo/run.sh denied           # judge with the marketplace grant removed → Wassette blocks it
#   bash demo/run.sh denied-seller <task_id>  # seller with the Ollama grant removed; the task is released
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "missing .env (run: pnpm setup:env)"; exit 1; }
set -a; . ./.env; set +a

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

case "${1:-}" in
  check)
    step "env"
    for k in MARKETPLACE_URL INSFORGE_API_KEY STRIPE_SECRET_KEY INKBOX_API_KEY ANTHROPIC_API_KEY JUDGE_PRIVATE_KEY_B64 JUDGE_REGISTRATION_SECRET; do
      [ -n "${!k:-}" ] && echo "  $k set" || echo "  $k MISSING"
    done
    step "ollama"; curl -sf "${OLLAMA_URL:-http://localhost:11434}/api/tags" | grep -o '"name":"[^"]*"' || echo "  ollama not running (brew services start ollama)"
    step "wassette"; wassette --version 2>/dev/null | head -1 || echo "  wassette missing (brew install wassette)"
    step "runner.wasm"; [ -f packages/runner-wasm/dist/runner.wasm ] && cat packages/runner-wasm/dist/runner.wasm.sha256 || echo "  not built (pnpm build:runner)"
    step "marketplace"; curl -sf "${MARKETPLACE_URL%/mcp}/health" || echo "  server not reachable at ${MARKETPLACE_URL}"
    echo ;;
  fresh)
    step "free Inkbox slots, forget local buyer/seller identities"
    node demo/inkbox-reset.mjs --yes
    rm -f .atm-state/buyer.json .atm-state/seller.json
    echo "next: start seller + judge, then 'happy' (the buyer registers on first post)" ;;
  server)
    pnpm dev:server -- --no-open ;;
  seller)
    pnpm daemon --role seller --runtime "${SELLER_RUNTIME:-wassette}" ;;
  judge)
    pnpm daemon --role judge --runtime wassette ;;
  happy)
    step "buyer posts: capital of France, rubric contains 'Paris' (hold appears in Stripe)"
    node scripts/buyer.mjs post "What is the capital of France? Answer in one word." --expect Paris --max 100 ;;
  reject)
    step "buyer posts: 2+2 with a deliberately wrong expected token → judge REJECTs"
    node scripts/buyer.mjs post "What is 2+2? Answer with a digit only." --expect five --max 100 ;;
  result)
    node scripts/buyer.mjs result "${2:?task_id}" ;;
  denied)
    step "judge sandbox WITHOUT the marketplace grant: Wassette blocks the request"
    pnpm daemon --role judge --runtime wassette --deny-marketplace --once ;;
  denied-seller)
    step "seller sandbox WITHOUT the Ollama grant (Wassette matches hostnames, so the marketplace must be 127.0.0.1)"
    MARKETPLACE_URL="http://127.0.0.1:${PORT:-3000}/mcp" pnpm daemon --role seller --runtime wassette --deny-ollama --task-id "${2:?task_id (post one with: run.sh happy)}" --once ;;
  *)
    sed -n '2,16p' "$0"; exit 1 ;;
esac
