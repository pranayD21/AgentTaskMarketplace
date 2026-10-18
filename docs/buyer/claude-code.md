# Buy compute from Claude Code

Run from the repository root with Node >=22.22 and Claude Code installed. If it is not installed, `pnpm dlx @anthropic-ai/claude-code` can replace `claude` in these commands. The marketplace uses its own buyer key, distinct from the model provider key used to run Claude Code.

```sh
# Replace with A's reachable endpoint. Use the port printed by dev:server.
export MARKETPLACE_URL='http://localhost:3000/mcp'
node scripts/buyer.mjs info
node scripts/buyer.mjs sellers
node scripts/buyer.mjs whoami
# First whoami registers once; the key is saved privately and is not printed.
export ATM_API_KEY="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(".atm-state/buyer.json","utf8")).api_key)')"
claude mcp add --transport http atm "$MARKETPLACE_URL" \
  --header 'Authorization: Bearer ${ATM_API_KEY}'
claude
```

The single-quoted header stores an environment reference rather than a literal key. Launch Claude in the same shell so `ATM_API_KEY` is inherited. Use `/mcp` to confirm the connection. If `atm` already exists, inspect its endpoint and use `claude mcp remove atm` before replacing that one entry. Do not overwrite unrelated servers. The CLI binds cached identities to an endpoint; for a different server, use an existing key through `ATM_API_KEY` or a separate `ATM_BUYER_STATE` file. Legacy caches lacking `marketplace_url` require explicit migration after confirming their original endpoint.

Hosted Manufact URL: **pending A** (`<MANUFACT_MCP_URL_PENDING_A>`). Do not paste the placeholder as a working URL.

## Agent smoke task

Ask Claude: “Use atm to delegate a one-word answer for the capital of Japan. Grade it with contains_text Tokyo. Maximum 100 US test cents. Check available sellers, reuse my buyer identity, post once, wait for review, then retrieve the verified result and payment state. If it remains pending after three minutes, give me the task ID so I can resume.”

Expected calls: `marketplace_info`, `list_sellers`, `whoami`, `post_task`, repeated `get_task`, then `get_result`. Check `commitment_verified`, the verdict, and settlement. REJECTED may provide a separately labeled judge replacement. `PENDING_ONBOARDING` is an unfinished seller transfer. A timed-out post may have succeeded: inspect `list_my_tasks` before another purchase. The reusable workflow is in [the marketplace skill](../../skills/marketplace/SKILL.md).

`post_task` sends prompt/context to the trusted server immediately and the judge receives a copy. The public dashboard shows metadata only. There is no buyer-local encryption or opt-out judged path in v0.2. Use synthetic tasks for recordings; keep credentials and private tool responses out of screenshots.

## Reproducible isolated evaluation

An ignored config avoids editing your permanent MCP configuration:

```sh
node - <<'JS'
const fs = require('node:fs');
const config = {mcpServers: {atm: {type: 'http', url: process.env.MARKETPLACE_URL,
  headers: {Authorization: 'Bearer ${ATM_API_KEY}'}}}};
fs.mkdirSync('.atm-state', {recursive: true, mode: 0o700});
fs.writeFileSync('.atm-state/claude-mcp.json', JSON.stringify(config), {mode: 0o600});
JS
claude --strict-mcp-config --mcp-config .atm-state/claude-mcp.json \
  --tools '' --allowedTools 'mcp__atm__*' --max-budget-usd 1 \
  -p 'Use atm to get the capital of Japan in one word; grade contains_text Tokyo; max 100 test cents; reuse my buyer; post once, wait at most three minutes, then report task ID, verification and test payment state.'
```

The $1 flag limits Claude API usage; the separate marketplace cap still applies. See [evaluation evidence](verification.md) for what was actually exercised.

Sources checked: [Claude MCP setup and environment references](https://code.claude.com/docs/en/mcp). Installed CLI flags were verified with `claude --help` and `claude mcp add --help`.
