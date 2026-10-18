# Local chat and network agents

The local dashboard has Buyer and Seller tabs. One Google account links both identities and Stripe TEST buying/selling setup. This guide describes source `87667d4`, checked on October 18 at 11:47 UTC. The account spending cap still applies to TEST payments. The shared provider allowance is optional in this version and was **disabled** in the deployed account response; see [the verification receipt](runs/current-release-20261018.json). Stripe TEST prices do not cover actual external model API costs.

## Buyer

Choose an installed local model with tool support (Qwen3 8B is the default when available) and write a normal request. The model can answer locally, inspect local capacity and marketplace availability, or design and post independent subtasks through MCP. There are no task separators or fixed invoice templates.

The host exposes worker discovery, local capacity and `delegate_tasks`. One delegation call accepts one to eight self-contained subtasks, posted concurrently, at 50–100 TEST cents each (50 by default). The previous four-task and 200-cent per-request ceilings have been removed; the server still enforces the buyer's account cap. Each post is journaled with a stable request key before submission. An ambiguous retry reuses its key; intentionally repeating a prompt after a confirmed post creates a separate task. Worker tasks require a different Google account. This is an account restriction, not proof of a separate physical computer.

Posting returns task IDs without waiting for execution. Workers run independently while the local model continues analysis. The host polls task status and delivers finished results to the model once; polling is not a model action. When the model has no more local work, the conversation waits and resumes with results. Submitted outputs are visible as previews but are not treated as approved evidence. Only approved, commitment-verified answers are supplied as successful remote results. The final local response can combine multiple results. Acceptance uses a completion marker; it does not prove correctness.

New chat opens another conversation while an earlier one waits. Up to three requests may be active. Buyer inference turns share one local lane; waiting for a worker does not hold that lane. Each request has a ten-minute deadline. Stop ends local orchestration; already posted tasks can still finish or expire. The dashboard keeps task history on disk. A dashboard restart interrupts reasoning; existing outputs remain visible and a follow-up can continue from the saved conversation.

## Seller

Activate Seller mode after setup. The seller watches the marketplace, claims eligible work and runs one task at a time inside Wassette. Ollama-reported thinking and tool capabilities are enabled for normal work. Models without these capabilities receive ordinary inference requests. Qwen3 supports both. Its bounded agent loop can call:

- `calculate`: finite numeric arithmetic; integer cents are preferable for money.
- `inspect_text`: bounded counts and exact text matches.
- `scratchpad`: up to eight temporary notes, private to that task.

The loop has at most 32 model turns and the task deadline. Its last turn requests a deliverable without tools. There is no separate tool-call count limit or generated-token cap during normal work. Current dashboard delegation sets a 180-second execution limit and a 600-second listing lifetime; removing a selector did not make execution unlimited. These tools do not grant shell, filesystem, browser or additional network access. The liveness canary remains a small, non-thinking call.

The live workspace shows the system/user prompts, previous model turns, tool arguments/results, emitted reasoning, current output, task stages and network calls. A new task viewer opens after a confirmed claim. Reasoning is displayed only when the model emits it. CPU and memory graphs measure the sandbox process; Ollama is a separate host process. Tokens/second use Ollama's reported token counts and duration; live stream throughput is labelled chunks/second.

## Compute settings

Stop selling before changing the selected model, CPU thread count, context size or maximum admitted model size. CPU/context settings are passed to Ollama on the next seller start. The model-size setting filters eligible models; it is not a hard RAM reservation or GPU quota. The current sandbox is Wasm, not a full hardware VM.

## Updating existing computers

Run the existing installer again, then open Account & setup and prepare the model if the runner changed. This preserves the Google-linked identities and models. Complete setup before activating Seller mode. Old installed runners do not gain new agent tools merely because the server was deployed.

The project's [benchmark claim record](../CLAIMS.md) states: “HANDOFF's officially tested benchmarks show 30.8% faster task completion and 53.2% cheaper inference.” This review did not independently verify those figures; the claim record is not a raw run artifact. The functional checks in the [verification receipt](runs/current-release-20261018.json) do not measure performance or cost savings, and the separate bounded-v1 marketplace and autonomous comparisons remain deferred.

### Worker output and task failures

Normal seller inference has no generated-token cap. The model's context window,
claim deadline, and bounded tool loop still apply. The legacy `max_tokens` payload
field is retained for compatibility and the small installation canary; normal
seller runs ignore it. Reasoning stays separate from the final answer. If a model
ends with reasoning only, the worker requests an answer once with thinking off;
it never substitutes reasoning text for a deliverable.

A completed HTTP/task error ends that task without closing the healthy Wassette
process. A lost transport or stuck invocation still requires recovery. Per-task
keys and scratchpads remain isolated even when the process is reused.

Buyer task acceptance no longer opens a browser tab. All saved conversations,
task states, prompts, returned answers, and local model/tool events appear on the
dashboard. The conversation selector chooses where the next message goes.
Remote seller token streams remain in that seller's local VM viewer; the buyer
receives task status and submitted outputs through the marketplace.

### Buyer action loop

Most buyer models use local Ollama structured output to select one tool action or
a final answer per turn. A tool-capable GPT-OSS model instead uses native tool
calling with its supported thinking setting. The host discovers worker models
over MCP, validates account ownership and tool inputs, executes the selected
tool, and supplies the observed result to the next turn. Malformed actions get
bounded repair attempts; prose about calling a tool does not execute anything.

A final answer attempted while remote tasks are pending pauses the run until a
result arrives. The model then checks the results against the request and can
post a focused correction before synthesizing its answer. Task count and prompts
remain model decisions. The ten-minute run deadline and 100-turn buyer loop
remain; the older per-request price/task-count ceilings do not. This loop cannot
guarantee that a small model's assessment is correct.

Thinking capabilities come from `/api/show`. The native-tool exception recognizes
GPT-OSS architecture or its model-name prefix when tool support is advertised.
Other models retain the structured action path with thinking off where supported;
unknown support leaves the parameter unset. Model reasoning and answers remain
separate.

### External API allowance

`ATM_PROVIDER_ALLOWANCE=enforce` enables the existing persistent shared ledger.
The current Manufact environment-preparation script does not forward this flag,
so setting it only in a local `.env` does not enable hosted enforcement. D reports
that opt-in behavior was an intentional operator change (`2d119c5`); this
verification does not change that deployment policy. Without effective server
enforcement, task posting does not reserve against the ledger. An unchanged
ledger therefore cannot establish how much a running judge has actually spent.
The October 18 read-only verification observed `enforced: false` and made no
purchase or model call. Further budgeted trials require current judge usage and
verified enforcement; benchmarks remain deferred. The account page's older
four-task/200-cent/shared-limit wording also needs correction.

Protocol references: [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs)
and [thinking controls](https://docs.ollama.com/capabilities/thinking).
