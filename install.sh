#!/bin/bash
# Install or update the Agent Task Marketplace seller + local dashboard on an Apple silicon Mac.
# Always runs the installer from the latest published seller release, so this file never goes stale:
#   curl -fsSL https://raw.githubusercontent.com/pranayD21/AgentTaskMarketplace/main/install.sh | bash
# Identities, models and the marketplace binding are kept. Payments are Stripe TEST mode.
set -euo pipefail
REPO="${ATM_GITHUB_REPO:-pranayD21/AgentTaskMarketplace}"
INSTALLER="https://github.com/$REPO/releases/latest/download/install.sh"
SCRIPT="$(curl -fsSL --proto '=https' "$INSTALLER")" || { printf 'Could not download the installer from %s\n' "$INSTALLER" >&2; exit 1; }
exec bash -c "$SCRIPT"
