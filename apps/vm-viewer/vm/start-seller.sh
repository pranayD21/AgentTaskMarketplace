#!/usr/bin/env bash
# Run inside a seller VM: start the Ollama tap and the Wassette seller daemon,
# logging where the VM viewer looks. Expects the repo at ~/atm and the
# marketplace reachable at $MARKETPLACE_URL (default: reverse-tunnelled 127.0.0.1:3000).
set -euo pipefail
DIR="$HOME/atm/.atm-state/vm-viewer"
mkdir -p "$DIR"
pkill -f "vm-viewer/vm/ollama-tap.mjs" 2>/dev/null || true
TAP_THINK="${TAP_THINK:-1}" nohup node "$HOME/atm/apps/vm-viewer/vm/ollama-tap.mjs" >>"$DIR/tap.out" 2>&1 &
sleep 1
cd "$HOME/atm/apps/agent-daemon"
# Wassette 0.8 grants by hostname: keep marketplace (127.0.0.1) and Ollama (localhost) distinct.
export MARKETPLACE_URL="${MARKETPLACE_URL:-http://127.0.0.1:3000/mcp}"
export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11435}"
exec ../../node_modules/.bin/tsx src/main.ts --role seller --runtime wassette --poll-ms 3000 \
  --display-name "${SELLER_NAME:-seller-$(hostname)}" 2>&1 | tee -a "$DIR/seller.log"
