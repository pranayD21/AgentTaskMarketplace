# @atm/dashboard — local workspace UI

React + Vite + Tailwind source for the dashboard the agent daemon serves at
`http://127.0.0.1:43118`. The build writes fixed-name assets into
[`apps/agent-daemon/ui`](../agent-daemon/ui): `seller.html` (served as `/`),
`task.html` (per-task viewer, same bundle), `seller.js` and `seller.css`. Those
built files are committed so the daemon, its tests and the release bundle need
no extra build step. The daemon's routes, security headers and CSP are unchanged;
the page uses no inline scripts, no external fonts and no remote assets.

```sh
pnpm --filter @atm/dashboard dev        # http://127.0.0.1:5174 with the MOCK API (no real accounts, payments or models)
pnpm --filter @atm/dashboard build      # rebuild apps/agent-daemon/ui — commit the output with your UI change
pnpm --filter @atm/dashboard test       # setup gating and chat timeline logic
```

Screens: an onboarding screen (Google sign-in and Stripe TEST buying) gates the
workspace; the workspace has a Buyer window (local agent chat with tool calls,
task cards and approved outputs) and a Seller window (seller mode, live resource
charts sampled from `/api/status`, compute allocation, local models, live
workspace iframe). The account page holds the full five-step checklist.

The mock in `mock/` is development-only: it labels itself `MOCK · LOCAL
PREVIEW`, never contacts the marketplace, Stripe, Google or Ollama, and is not
part of the build.
