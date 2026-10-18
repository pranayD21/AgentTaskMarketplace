# Runner helpers

`runCycle(host, opts)` in `src/seller-cycle.ts` performs one seller task inside one component instance. `host` provides `fetch`, `getSecret` and `now`; the seller API key comes from `getSecret("AGENT_API_KEY")`. `opts` contains `marketplace_url`, `ollama_url`, `task_id`, `model_id` and `max_runtime_s`. The returned summary contains IDs, timing, token count and public key ID. No private key, prompt or answer leaves the component through this return value.

While the marketplace requires registered keys, supply `legacy_registration` with the complete model inventory and runtime metadata. The cycle registers its newly generated public key before claiming. Once A ships the per-claim API, omit that field. Claim responses can provide recipient keys either inside `claim` or alongside it; otherwise the cycle calls `get_recipient_keys`.

Computer E can reuse `FetchMarketplace` from `src/marketplace.ts` in `judge-cycle`:

```ts
const key = await host.getSecret("AGENT_API_KEY");
if (!key) throw new Error("MISSING_AGENT_API_KEY");
const marketplace = new FetchMarketplace(opts.marketplace_url, key, host.fetch);
const review = await marketplace.call("fetch_review_package");
```

The helper initializes MCP, sends `notifications/initialized`, carries the session and negotiated protocol headers, and reads JSON or SSE results. It matches response IDs, ignores SSE heartbeats and cancels the stream when the matching response arrives. Tool errors become `MarketplaceError` with a code-only message. It applies bounded HTTP deadlines and does not automatically retry mutations. Callers should keep error text, task material and secrets out of public logs.

E's single-call judge export should restore randomness before key use, fetch the review package, verify the result commitment, judge and submit within the same call. It needs the marketplace origin, the judge-model origin, and environment grants for `AGENT_API_KEY`, `JUDGE_PRIVATE_KEY_B64` and `ANTHROPIC_API_KEY`. Current judge-loop changes remain E's assignment. C retained its existing exports and judge logic.

Wassette 0.8 ignores network ports and misparses bare `localhost:port` as a URL scheme. Supply complete origins such as `http://localhost:3000` in grants. Treat the effective sandbox permission as scheme plus hostname. `withDeadline` also races the operation against a timer because wasi:http fetch did not honor `AbortSignal` in the integration check.
