#!/bin/bash
set -euo pipefail
umask 077
ATM_ORIGIN="__ATM_BASE_URL__"
ATM_ROOT="$HOME/.atm"
fail() { printf '\nSeller setup stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail 'This release supports Apple silicon Macs only.'
[[ "$(id -u)" != 0 ]] || fail 'Run as your normal macOS user, not with sudo.'
[[ "$ATM_ORIGIN" == https://* ]] || fail 'Download the installer from the hosted HTTPS marketplace.'
[[ ! -L "$ATM_ROOT" ]] || fail '~/.atm must not be a symbolic link.'
printf 'Installing the marketplace seller. Setup opens in your browser. Google sign-in and Stripe payout setup are required. Payments are Stripe TEST mode.\n'
if ! command -v brew >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/brew ]]; then
  printf 'Installing Homebrew. macOS may request your administrator password or developer-tool approval.\n'
  ATM_BREW_SCRIPT="$(mktemp -t atm-homebrew)"
  curl -fsSL --proto '=https' https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$ATM_BREW_SCRIPT"
  if [[ -r /dev/tty ]]; then /bin/bash "$ATM_BREW_SCRIPT" </dev/tty; else NONINTERACTIVE=1 /bin/bash "$ATM_BREW_SCRIPT"; fi
  rm -f "$ATM_BREW_SCRIPT"
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
command -v brew >/dev/null || fail 'Complete Homebrew setup and run this command again.'
brew install node pnpm ollama wassette
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<22))process.exit(1)' || fail 'Node 22.22 or newer is required.'
wassette --version | /usr/bin/grep -Eq '(^|[[:space:]])0\.8\.' || fail 'This release requires Wassette 0.8.x. No seller identity has been created.'
mkdir -p "$ATM_ROOT"
chmod 700 "$ATM_ROOT"
ATM_PNPM="$(command -v pnpm)"
if [[ "$($ATM_PNPM --version)" != 10.* ]]; then
  npm install --prefix "$ATM_ROOT/tools" --no-audit --no-fund pnpm@10.33.2
  ATM_PNPM="$ATM_ROOT/tools/node_modules/.bin/pnpm"
fi
brew services start ollama
ATM_READY=0
for ATM_ATTEMPT in {1..30}; do
  if curl -fsS http://localhost:11434/api/tags >/dev/null; then ATM_READY=1; break; fi
  sleep 1
done
[[ "$ATM_READY" == 1 ]] || fail 'Ollama did not start. Check brew services info ollama and retry.'
ATM_STAGE="$(mktemp -d "$ATM_ROOT/.stage-XXXXXXXX")"
trap 'if [[ -n "${ATM_STAGE:-}" && -d "$ATM_STAGE" ]]; then rm -rf "$ATM_STAGE"; fi' EXIT
curl -fsSL --proto '=https' "$ATM_ORIGIN/api/seller-release" -o "$ATM_STAGE/release.json"
curl -fsSL --proto '=https' "$ATM_ORIGIN/seller-bundle.tgz" -o "$ATM_STAGE/seller-bundle.tgz"
curl -fsSL --proto '=https' "$ATM_ORIGIN/runner.wasm" -o "$ATM_STAGE/runner.wasm"
curl -fsSL --proto '=https' "$ATM_ORIGIN/runner.wasm.sha256" -o "$ATM_STAGE/runner.wasm.sha256"
node --input-type=module - "$ATM_STAGE" <<'NODE'
import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto';
const dir=process.argv[2]; const manifest=JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8'));
if(manifest.schema!==1||manifest.platform!=='darwin-arm64'||manifest.seller_protocol!==1)throw Error('Unsupported seller release');
for(const name of ['seller-bundle.tgz','runner.wasm']){
 const expected=manifest.artifacts?.[name]?.sha256;
 if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Missing release checksum');
 const actual=createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');
 if(actual!==expected)throw Error(name+' checksum mismatch; nothing has been installed');
}
if(fs.readFileSync(path.join(dir,'runner.wasm.sha256'),'utf8').trim().split(/\s+/)[0]!==manifest.artifacts['runner.wasm'].sha256)throw Error('Runner checksum files disagree');
NODE
tar -tzf "$ATM_STAGE/seller-bundle.tgz" > "$ATM_STAGE/archive-members.txt"
if /usr/bin/grep -Eq '(^/|(^|/)\.\.(/|$))' "$ATM_STAGE/archive-members.txt"; then fail 'Unsafe archive path'; fi
tar -xzf "$ATM_STAGE/seller-bundle.tgz" -C "$ATM_STAGE"
mkdir -p "$ATM_STAGE/packages/runner-wasm/dist"
mv "$ATM_STAGE/runner.wasm" "$ATM_STAGE/packages/runner-wasm/dist/runner.wasm"
rm -f "$ATM_STAGE/seller-bundle.tgz" "$ATM_STAGE/runner.wasm.sha256"
(cd "$ATM_STAGE" && "$ATM_PNPM" install --frozen-lockfile --prod --ignore-scripts)
node "$ATM_STAGE/control.mjs" install "$ATM_STAGE" "$ATM_ORIGIN/mcp" "$(command -v node)"
ATM_STAGE=''
