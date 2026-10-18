# Marketplace dashboard

Public React + TypeScript + Vite dashboard. It polls the marketplace's `GET /api/dashboard` three seconds after each completed request, without overlapping requests. The default API is `http://localhost:3000`.

```sh
pnpm install
# Optional: copy apps/web/.env.example to apps/web/.env.local and set the shared API origin.
pnpm --filter @atm/web dev      # http://127.0.0.1:5173
pnpm --filter @atm/web build
pnpm --filter @atm/web test
```

Set `VITE_MARKETPLACE_BASE_URL` to the server origin (an `/mcp` suffix is also normalized). Restart Vite after changing it. All `VITE_*` values are public browser configuration; never put API keys or private material there. The browser needs CORS access to the shared server. No demo fixtures are used as live data.

The board shows all state counts and the latest 40 tasks. Sellers are the latest 50 registrations, which do not prove online availability. It includes runtime badges, the registered/latest-claim key source, model asks, claim leases, test PaymentIntent links, verdict codes, payouts/refunds, onboarding notices, and the latest 60 events. MEMORY storage is explicitly labeled temporary development/test data. A failed refresh preserves the last good snapshot and visibly marks it stale; the initial empty state is distinct from an error.

The response parser strips unknown fields; the view does not render event metadata, free-form verdict reasons, raw settlement notes, ciphertext, or raw JSON. Only the presence of `PENDING_ONBOARDING` is extracted from settlement notes. This limits accidental private-data rendering, but cannot repair a server that sends private fields over the network. Test the server boundary independently.

`pnpm --filter @atm/web test` exercises the rendered privacy boundary, runtime/payment labels, state filters, leases, links, and buyer CLI protocol/identity behavior. Browser checks and integration outcomes are recorded in [buyer verification](../../docs/buyer/verification.md).
