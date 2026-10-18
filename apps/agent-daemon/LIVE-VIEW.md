# Sandbox live view

A local web GUI that shows, as it happens, what each sandbox instance does while a model runs a task.

```sh
# See the GUI with simulated data (no Wassette, Ollama or marketplace needed)
pnpm --filter @atm/agent-daemon live:demo

# A real seller or judge with the GUI
pnpm --filter @atm/agent-daemon live --role seller
pnpm --filter @atm/agent-daemon live --role judge
# same as: pnpm --filter @atm/agent-daemon start --viewer ...   (or ATM_VIEWER=1)
```

The page is served at http://localhost:4700, bound to 127.0.0.1 only. Each new Wassette instance (one `wassette run` process) opens its own window at `/vm/<id>`. Chrome opens as an app window when installed; otherwise the default browser opens.

| flag / env | default | meaning |
|---|---|---|
| `--viewer` / `ATM_VIEWER=1` | off | start the live view |
| `--viewer-port` / `ATM_VIEWER_PORT` | `4700` | port (`0` picks a free one) |
| `--viewer-open` / `ATM_VIEWER_OPEN` | `each` | `each`: one window per new instance; `first`: one overview window; `never` |
| `--viewer-no-tap` | tap on | do not route sandbox traffic through the observer tap |
| `ATM_VIEWER_BROWSER` | — | command used to open windows |

## What it shows

- **Instances.** Role, state (booting, ready, busy, closed, crashed, with the reason), pid, uptime, boot time, live CPU and memory of the Wassette process, the network allow-list, env grants and the runner.wasm sha256.
- **Boot.** Spawn, `load-component` and each permission grant, with timings.
- **Task run pipeline.** Seller: claim → start → recipient keys → model check → inference → submit. Judge: fetch review → decrypt + grade → verdict. Each stage shows its timing, and earlier runs stay selectable.
- **Prompt and live model output.** The messages sent to Ollama and the tokens as they are generated, with tok/s, time to first token and prompt token count.
- **Network traffic.** Every MCP call and Ollama request the sandbox makes. Click a row to see the request and response. Ciphertext is shortened.
- **Event stream.** Daemon log, calls into the instance, and Wassette stderr.

## How it works

`src/viewer/server.ts` serves the page and streams events over SSE. `WassetteRuntime` reports lifecycle, calls and stderr through `SandboxObserver` (`src/viewer/types.ts`).

The **observer tap** (`src/viewer/tap.ts`) is what makes the prompt and output visible. They exist decrypted only inside the sandbox, so the tap starts two 127.0.0.1 forwarders, one for the marketplace and one for Ollama. The sandbox is granted those origins in place of the real ones. Each forwarder relays to exactly one upstream, so the sandbox can still reach only the same two services. Ollama chat calls are streamed upstream so tokens appear live, then reassembled into the single JSON reply the runner expects. With `--deny-ollama`, Ollama is not tapped, so the policy demo still blocks it.

The judge's grading call goes to `api.anthropic.com` over TLS and is not tapped. The page shows the review package and the verdict.

## Caveats

- **Demo aid, not for production.** The tap deliberately exposes decrypted task prompts and model output on the seller machine. That defeats the confidentiality the runner otherwise keeps from the daemon process. Use `--viewer-no-tap` to keep only lifecycle, calls and stderr.
- After a `--once` run the daemon keeps the page up until Ctrl-C, so you can inspect the run.
- CPU and memory come from `ps`, so they are not shown on Windows.
- The Wassette sandbox is WebAssembly isolation under a network policy. It is not a TEE.
