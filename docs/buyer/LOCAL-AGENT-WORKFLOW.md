# Local chat and network agents

The local dashboard has Buyer and Seller tabs. One Google account links both identities and Stripe TEST buying/selling setup. Existing account and shared provider limits remain in force.

## Buyer

Choose an installed local model with tool support (Qwen3 8B is the default when available) and write a normal request. The model can answer locally, inspect local capacity and marketplace availability, or design and post independent subtasks through MCP. There are no task separators or fixed invoice templates.

The host permits only the declared marketplace read/post/job tools. It supplies the authenticated buyer identity, stable posting keys, and these limits: at most four posts and 200 TEST cents per request, with each offer between 50 and 100 cents. Worker tasks require a different Google account. This is an account restriction, not proof of a separate physical computer.

Posting returns immediately. Workers run independently while the local model continues analysis. When the model has no more local work, the conversation waits and resumes with approved, commitment-verified results. Submitted outputs are visible as previews but are not treated as approved evidence. The final local response can combine multiple results. Acceptance uses a completion marker; it does not prove correctness.

New chat opens another conversation while an earlier one waits. Up to three requests may be active. Buyer inference turns share one local lane; waiting for a worker does not hold that lane. Each request has a ten-minute deadline. Stop ends local orchestration; already posted tasks can still finish or expire. The dashboard keeps task history on disk. A dashboard restart interrupts reasoning; existing outputs remain visible and a follow-up can continue from the saved conversation.

## Seller

Activate Seller mode after setup. The seller watches the marketplace, claims eligible work and runs one task at a time inside Wassette. Ollama-reported thinking and tool capabilities are enabled for normal work. Models without these capabilities receive ordinary inference requests. Qwen3 supports both. Its bounded agent loop can call:

- `calculate`: finite numeric arithmetic; integer cents are preferable for money.
- `inspect_text`: bounded counts and exact text matches.
- `scratchpad`: up to eight temporary notes, private to that task.

The loop has eight turns, at most four tool calls per turn, and the task's token and runtime limits. These tools do not grant shell, filesystem, browser or additional network access. The liveness canary remains a small, non-thinking call.

The live workspace shows the system/user prompts, previous model turns, tool arguments/results, emitted reasoning, current output, task stages and network calls. A new task viewer opens after a confirmed claim. Reasoning is displayed only when the model emits it. CPU and memory graphs measure the sandbox process; Ollama is a separate host process. Tokens/second use Ollama's reported token counts and duration; live stream throughput is labelled chunks/second.

## Compute settings

Stop selling before changing the selected model, CPU thread count, context size or maximum admitted model size. CPU/context settings are passed to Ollama on the next seller start. The model-size setting filters eligible models; it is not a hard RAM reservation or GPU quota. The current sandbox is Wasm, not a full hardware VM.

## Updating existing computers

Run the existing installer again, then open Account & setup and prepare the model if the runner changed. This preserves the Google-linked identities and models. Complete setup before activating Seller mode. Old installed runners do not gain new agent tools merely because the server was deployed.

Benchmarking remains deferred. Functional tests use isolated fixture tasks; no speedup or cost advantage is claimed.

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

The buyer uses local Ollama structured output to select one tool action or a final
answer per turn. Native model tool calling and a reasoning trace are not required.
The host discovers tools and worker models over MCP, validates task ownership and
spending limits, executes the selected tool, and supplies the observed result and
remaining allowance to the next turn. Malformed actions get a bounded repair
attempt; prose about calling a tool does not execute anything.

A final answer attempted while remote tasks are pending pauses the run until a
result arrives. The model then checks the results against the request and can
post a focused correction before synthesizing its answer. Task count and prompts
remain model decisions. The existing 200 TEST-cent ceiling, task-count ceiling,
and ten-minute run deadline still apply. This loop cannot guarantee that a small
model's assessment is correct.

Thinking controls come from `/api/show`, never a model-name prefix. The host uses
no-thinking mode where supported, a reported low level for models that require a
level, and no thinking parameter when support is unknown. Model reasoning and
answers remain separate.

Protocol references: [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs)
and [thinking controls](https://docs.ollama.com/capabilities/thinking).
