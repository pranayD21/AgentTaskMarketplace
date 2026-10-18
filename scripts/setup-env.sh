#!/usr/bin/env bash
# Interactive .env setup. Secrets are read with `read -s`, so nothing you paste
# is echoed to the terminal or written anywhere except .env (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

set_var() { # set_var KEY VALUE — replace or append; value never printed
  local key="$1"
  ATM_VAL="$2" awk -v k="$key" '
    BEGIN { v = ENVIRON["ATM_VAL"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
}

current_value() { # prints the current value of KEY with any trailing comment stripped
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+|[[:space:]]+$//g' || true
}

is_placeholder() { # true when empty or still an example value like sk_test_...
  [ -z "$1" ] || [[ "$1" == *"..."* ]]
}

ask() { # ask KEY "description" [optional]
  local key="$1" desc="$2" mode="${3:-required}" cur val
  cur="$(current_value "$key")"
  if ! is_placeholder "$cur"; then
    printf '%-22s already set. Enter to keep, or paste a new value: ' "$key"
  elif [ "$mode" = optional ]; then
    printf '%-22s %s (optional, Enter to skip): ' "$key" "$desc"
  else
    printf '%-22s %s: ' "$key" "$desc"
  fi
  IFS= read -rs val; echo
  val="${val//$'\r'/}"
  if [ -n "$val" ]; then set_var "$key" "$val"; fi
}

echo "== Agent Task Marketplace — .env setup (values are hidden as you paste) =="
echo
ask INSFORGE_BASE_URL   "Insforge project URL, e.g. https://xxx.us-east.insforge.app"
ask INSFORGE_API_KEY    "Insforge admin API key (ik_...)"
ask INSFORGE_ANON_KEY   "Insforge anon key (not needed for the server; CLI: npx @insforge/cli secrets get ANON_KEY)" optional
ask STRIPE_SECRET_KEY   "Stripe sandbox secret key (sk_test_...)"
ask STRIPE_PROFILE_ID   "Stripe profile id for MPP mode (profile_test_...)" optional
ask INKBOX_API_KEY      "Inkbox org admin API key (ApiKey_...)"
ask ANTHROPIC_API_KEY   "Anthropic API key for the Judge model (sk-ant-...)"
echo

if is_placeholder "$(current_value SERVER_KEK_B64)"; then
  set_var SERVER_KEK_B64 "$(openssl rand -base64 32)"
  echo "generated SERVER_KEK_B64"
fi

if is_placeholder "$(current_value JUDGE_PRIVATE_KEY_B64)"; then
  while IFS= read -r line; do
    [ -n "$line" ] && set_var "${line%%=*}" "${line#*=}"
  done < <(pnpm --silent exec tsx scripts/gen-judge-keypair.ts)
  echo "generated judge X25519 keypair (JUDGE_PUBLIC_KEY_B64 / JUDGE_PRIVATE_KEY_B64 / JUDGE_KEY_ID)"
fi

chmod 600 "$ENV_FILE"
echo
echo "== status (values not shown) =="
for key in INSFORGE_BASE_URL INSFORGE_API_KEY INSFORGE_ANON_KEY STRIPE_SECRET_KEY STRIPE_PROFILE_ID INKBOX_API_KEY ANTHROPIC_API_KEY SERVER_KEK_B64 JUDGE_PUBLIC_KEY_B64 JUDGE_PRIVATE_KEY_B64 PAYMENT_MODE; do
  if is_placeholder "$(current_value "$key")"; then printf '  %-22s missing\n' "$key"; else printf '  %-22s set\n' "$key"; fi
done
echo
echo ".env written (mode 600, git-ignored). Re-run anytime to add or rotate a key."
