#!/usr/bin/env bash
# Demo driver. Each step is one subcommand so it can run in its own terminal
# pane; demo/README.md says what the audience should see at each step.
#
#   bash demo/run.sh check                     # preflight: env, ollama, wassette, runner.wasm, app health
#   bash demo/run.sh inkbox                    # list Inkbox identities (read-only; never resets shared ones)
#   bash demo/run.sh pricing                   # marketplace_info.pricing.mode (task_offer = posted offers)
#   bash demo/run.sh seller                    # seller daemon (SELLER_RUNTIME=wassette|node, default wassette)
#   bash demo/run.sh seller-task <task_id>     # seller claims exactly this task at its posted offer, once
#   bash demo/run.sh judge                     # judge daemon inside Wassette (judge-cycle); log saved under .atm-state/evidence/
#   bash demo/run.sh evidence <task_id>...     # public-only timeline, verdicts, settlements, cross-seller overlap
#   bash demo/run.sh happy                     # buyer posts a task at a 60c offer that should be APPROVED
#   bash demo/run.sh reject                    # buyer posts a task at a 60c offer the small model will fail → REJECT
#   bash demo/run.sh result <task_id>          # buyer reads the answer (commitment_verified, replacement_answer)
#   bash demo/run.sh denied                    # judge with the marketplace grant removed → Wassette blocks it
#   bash demo/run.sh denied-seller <task_id>   # seller with the Ollama grant removed; the task is released
#   bash demo/run.sh pay <payment_link>        # MPP mode: pay a task's 402 link, no phone (Stripe TEST helper)
#   bash demo/run.sh pay-sim                   # MPP mode: post + 402 challenge + pay, printed step by step
#   bash demo/run.sh server                    # fallback: local marketplace on :3000
#   bash demo/run.sh tunnel                    # fallback: local marketplace with a public tunnel URL
#
# MARKETPLACE_URL comes from .env (hosted: https://warm-cloud-4hh5i.run.mcp-use.com/mcp). The buyer
# posts the price (an offer); a seller accepts it by claiming, and it stays fixed through settlement.
# To keep demo tasks on the right machine, pin sellers with seller-task <task_id>.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "missing .env (run: pnpm setup:env)"; exit 1; }
set -a; . ./.env; set +a
: "${MARKETPLACE_URL:=https://warm-cloud-4hh5i.run.mcp-use.com/mcp}"
export MARKETPLACE_URL
OFFER_CENTS="${DEMO_OFFER_CENTS:-60}"
# Only for servers that predate task offers: a seller ask the offer covers. Ignored under task_offer.
LEGACY_ASK_CENTS="${DEMO_LEGACY_ASK_CENTS:-50}"
POLL_MS="${DEMO_POLL_MS:-5000}"

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# marketplace_info.pricing.mode over MCP (no auth); prints "unknown" when absent (pre-offer servers).
pricing_mode() {
  node -e '
    const url = process.env.MARKETPLACE_URL;
    const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const rpc = async (method, params, sid) => { const r = await fetch(url, { method: "POST", headers: sid ? { ...h, "mcp-session-id": sid } : h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const t = await r.text(); const line = t.split("\n").find((l) => l.startsWith("data:")); return { sid: r.headers.get("mcp-session-id"), json: JSON.parse(line ? line.slice(5) : t) }; };
    (async () => {
      const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "demo", version: "1" } });
      const res = await rpc("tools/call", { name: "marketplace_info", arguments: {} }, init.sid);
      const info = JSON.parse(res.json.result?.content?.[0]?.text ?? "{}");
      console.log(info.pricing?.mode ?? "unknown");
    })().catch(() => console.log("unknown"));'
}
seller_price_args() {
  if [ "$(pricing_mode)" = "task_offer" ]; then echo ""; else echo "--ask-cents $LEGACY_ASK_CENTS"; fi
}

case "${1:-}" in
  check)
    step "env"
    for k in MARKETPLACE_URL ANTHROPIC_API_KEY JUDGE_PRIVATE_KEY_B64 JUDGE_REGISTRATION_SECRET INKBOX_API_KEY; do
      [ -n "${!k:-}" ] && echo "  $k set" || echo "  $k MISSING"
    done
    echo "  marketplace: ${MARKETPLACE_URL}"
    step "ollama"; curl -sf "${OLLAMA_URL:-http://localhost:11434}/api/tags" | grep -o '"name":"[^"]*"' || echo "  ollama not running (brew services start ollama)"
    step "wassette"; wassette --version 2>/dev/null | head -1 || echo "  wassette missing (brew install wassette)"
    step "runner.wasm"; [ -f packages/runner-wasm/dist/runner.wasm ] && cat packages/runner-wasm/dist/runner.wasm.sha256 || echo "  not built (pnpm build:runner)"
    step "app health (/api/health; the hosted /health is the framework's, not ours)"
    curl -sf "${MARKETPLACE_URL%/mcp}/api/health" || echo "  not reachable: ${MARKETPLACE_URL%/mcp}/api/health"
    echo ;;
  inkbox)
    step "Inkbox identities (read-only). Free tier = 3: atm-marketplace + one buyer + one seller."
    node demo/inkbox-reset.mjs ;;
  pricing)
    echo "pricing.mode: $(pricing_mode)  (task_offer: buyers post offers; anything else: legacy seller asks, demo uses ${LEGACY_ASK_CENTS}c)" ;;
  seller)
    # shellcheck disable=SC2046
    pnpm daemon --role seller --runtime "${SELLER_RUNTIME:-wassette}" $(seller_price_args) --poll-ms "$POLL_MS" ;;
  seller-task)
    # shellcheck disable=SC2046
    pnpm daemon --role seller --runtime "${SELLER_RUNTIME:-wassette}" $(seller_price_args) --task-id "${2:?task_id}" --once ;;
  judge)
    mkdir -p .atm-state/evidence
    log=".atm-state/evidence/judge-$(date -u +%Y%m%dT%H%M%SZ).log"
    echo "judge log: $log (public metadata only); usage: .atm-state/judge-usage.jsonl"
    pnpm daemon --role judge --runtime wassette --poll-ms "$POLL_MS" 2>&1 | tee "$log" ;;
  evidence)
    node demo/evidence.mjs "${@:2}" ;;
  happy)
    step "buyer posts: capital of France, rubric contains 'Paris', offer ${OFFER_CENTS}c (hold appears in Stripe)"
    node scripts/buyer.mjs post "What is the capital of France? Answer in one word." --expect Paris --max "$OFFER_CENTS" ;;
  reject)
    step "buyer posts: 2+2 with a deliberately wrong expected token, offer ${OFFER_CENTS}c → judge REJECTs"
    node scripts/buyer.mjs post "What is 2+2? Answer with a digit only." --expect five --max "$OFFER_CENTS" ;;
  result)
    node scripts/buyer.mjs result "${2:?task_id}" ;;
  denied)
    step "judge sandbox WITHOUT the marketplace grant: Wassette blocks the request"
    pnpm daemon --role judge --runtime wassette --deny-marketplace --once ;;
  denied-seller)
    step "seller sandbox WITHOUT the Ollama grant (Wassette matches hostnames, so the marketplace must not be localhost)"
    # shellcheck disable=SC2046
    pnpm daemon --role seller --runtime wassette --deny-ollama $(seller_price_args) --task-id "${2:?task_id (post one with: run.sh happy)}" --once ;;
  pay)
    step "MPP (preview): pay the task's HTTP 402 payment link with a Stripe TEST shared payment token, no phone"
    node docs/payments/pay-task.mjs "${2:?payment_link from post_task in PAYMENT_MODE=mpp}" ;;
  pay-sim)
    step "MPP (preview): post → 402 challenge → test token → 200 + receipt → task OPEN/PAID"
    MARKETPLACE_URL="${MPP_MARKETPLACE_URL:-http://localhost:3001/mcp}" node docs/payments/simulate-spt.mjs --max 100 ;;
  server)
    pnpm dev:server --no-open ;;
  tunnel)
    step "fallback if the hosted server is down: share the printed tunnel URL with every computer"
    pnpm dev:server --no-open --tunnel ;;
  *)
    sed -n '2,23p' "$0"; exit 1 ;;
esac
