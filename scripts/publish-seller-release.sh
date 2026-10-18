#!/usr/bin/env bash
# Publish the seller release as a GitHub Release so any Mac can install or update with:
#   curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | bash
# The generated installer downloads the bundle from the release but still binds the daemon to
# the hosted marketplace (ATM_MARKETPLACE_ORIGIN), so no server redeploy is needed. The
# daemon's own compatibility check (contract version, seller protocol, runner hash) still runs
# against that marketplace at install time.
set -euo pipefail
cd "$(dirname "$0")/.."
ORIGIN="${ATM_MARKETPLACE_ORIGIN:-https://warm-cloud-4hh5i.run.mcp-use.com}"
REPO="${ATM_GITHUB_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
[[ "$ORIGIN" == https://* ]] || { echo "ATM_MARKETPLACE_ORIGIN must be an https origin" >&2; exit 1; }
node scripts/prepare-seller-release.mjs >/dev/null
node scripts/verify-seller-release.mjs
OUT=apps/marketplace-mcp/public/seller
REV="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).revision.slice(0,7))' "$OUT/release.json")"
TAG="seller-$REV"
BASE="https://github.com/$REPO/releases/download/$TAG"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp "$OUT/seller-bundle.tgz" "$OUT/runner.wasm" "$OUT/runner.wasm.sha256" "$OUT/release.json" "$STAGE/"
# Same installer the marketplace serves, with the four downloads pointed at the release assets.
sed -e "s|__ATM_BASE_URL__|$ORIGIN|" \
    -e "s|\"\$ATM_ORIGIN/api/seller-release\"|\"$BASE/release.json\"|" \
    -e "s|\"\$ATM_ORIGIN/seller-bundle.tgz\"|\"$BASE/seller-bundle.tgz\"|" \
    -e "s|\"\$ATM_ORIGIN/runner.wasm\"|\"$BASE/runner.wasm\"|" \
    -e "s|\"\$ATM_ORIGIN/runner.wasm.sha256\"|\"$BASE/runner.wasm.sha256\"|" \
    apps/agent-daemon/install.sh > "$STAGE/install.sh"
grep -q "$BASE/seller-bundle.tgz" "$STAGE/install.sh" || { echo "installer rewrite failed" >&2; exit 1; }
NOTES="Seller daemon and local dashboard at $REV. Install or update (identities and models are kept):

    curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | bash

Daemons bind to $ORIGIN. Payments are Stripe TEST mode."
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "$STAGE"/{install.sh,seller-bundle.tgz,runner.wasm,runner.wasm.sha256,release.json}
else
  gh release create "$TAG" --repo "$REPO" --latest --title "Seller release $REV" --notes "$NOTES" "$STAGE"/{install.sh,seller-bundle.tgz,runner.wasm,runner.wasm.sha256,release.json}
fi
echo "Published $TAG: curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | bash"
