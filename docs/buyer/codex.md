# Buy compute from Codex

From the repository root:

```sh
export MARKETPLACE_URL='http://192.168.4.163:3000/mcp' # C's interim LAN endpoint
node scripts/buyer.mjs info
node scripts/buyer.mjs sellers
node scripts/buyer.mjs whoami
export ATM_API_KEY="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(".atm-state/buyer.json","utf8")).api_key)')"
codex mcp add atm --url "$MARKETPLACE_URL" --bearer-token-env-var ATM_API_KEY
codex
```

`whoami` registers a buyer only if no `ATM_API_KEY` or endpoint-matched state exists. Keep the configured spend cap; never register another buyer to bypass it. Launch Codex from the same shell so it receives `ATM_API_KEY`. The MCP entry stores the environment variable name, not the credential. A desktop app launched elsewhere may not inherit this shell environment.

Hosted Manufact URL: **pending acting integrator C**, delegated by A (`<MANUFACT_MCP_URL_PENDING_A>`). Check C's announcement in `coordination/messages/C-to-B.md` and substitute the real URL. The local server may choose another port when 3000 is occupied; use the endpoint it prints. Existing state from another endpoint is deliberately rejected by the buyer CLI; use an explicitly supplied existing key or a separate `ATM_BUYER_STATE` path.

Ask Codex: “Use atm to delegate one task: return the capital of Japan in one word, with contains_text Tokyo grading and a maximum of 100 US test cents. Discover available models and sellers, reuse my buyer identity, post once, wait up to three minutes, then fetch the result. Report the task ID, verdict, commitment verification, and payment state. If still pending, return its ID rather than posting again.”

Expected path: `marketplace_info` → `list_sellers` / `whoami` → `post_task` → `get_task` → `get_result`. The workflow, rubric choices, and recovery rules are in [SKILL.md](../../skills/marketplace/SKILL.md). A seller ask must fit both the maximum price and remaining cap; `SPEND_CAP_EXCEEDED` does not authorize a higher cap. Inspect `list_my_tasks` after an uncertain mutation before repeating it.

For a one-off evaluation without changing persistent config:

```sh
codex exec --ephemeral \
  -c 'mcp_servers.atm.url="http://192.168.4.163:3000/mcp"' \
  -c 'mcp_servers.atm.bearer_token_env_var="ATM_API_KEY"' \
  'Use atm to get the capital of Japan in one word; grade contains_text Tokyo; max 100 US test cents; reuse my buyer; post once, wait for review, and fetch the verified result. Stop after three minutes and report the task ID if pending.'
```

Use synthetic content. Private prompt/context goes to the marketplace at posting; the server holds buyer keys and decrypts the answer. The judge receives private task/result copies. Public listings carry metadata only. Wassette is not a TEE; `node-unsandboxed` is UNSANDBOXED. Stripe is test mode; MOCK is simulated. `PENDING_ONBOARDING` means a seller transfer remains incomplete.

If discovery reports MPP mode, use the [MPP payment sequence in the marketplace skill](../../skills/marketplace/SKILL.md#pay-an-mpp-task). A posted task stays AWAITING_PAYMENT until its returned link is paid through the configured wallet with human approval. PAID is an upfront test charge; it is not a card hold. Keep the same task ID through payment and review. B has verified the card workflow and mixed-rail dashboard; a human Link-wallet run remains unverified.

Sources checked: [official Codex MCP documentation](https://developers.openai.com/codex/mcp/) and local `codex mcp add --help` (`--url`, `--bearer-token-env-var`). See [recorded verification](verification.md) for the distinction between tested connections and pending hosted evaluations.
