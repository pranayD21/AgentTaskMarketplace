#!/usr/bin/env bash
# Apply apps/marketplace-mcp/db/schema.sql to the Insforge project in .env
# through the admin raw-SQL endpoint. Idempotent; safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${INSFORGE_BASE_URL:?}" "${INSFORGE_API_KEY:?}"
SQL_FILE="${1:-apps/marketplace-mcp/db/schema.sql}"
BODY=$(node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(process.argv[1],"utf8")}))' "$SQL_FILE")
STATUS=$(curl -s -o /tmp/atm_migrate.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $INSFORGE_API_KEY" -H "Content-Type: application/json" \
  -d "$BODY" "$INSFORGE_BASE_URL/api/database/advance/rawsql")
echo "rawsql -> HTTP $STATUS"
cut -c1-400 /tmp/atm_migrate.json; echo; rm -f /tmp/atm_migrate.json
[ "$STATUS" = 200 ] || [ "$STATUS" = 201 ]
