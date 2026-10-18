/** A local model chooses every action. The host only dispatches declared tools. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  invoke(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface ToolCall { function: { name: string; arguments: Record<string, unknown> } }
export interface ChatMessage {
  role: string; content: string; tool_name?: string; tool_calls?: ToolCall[];
}
export interface AgentEvent { type: string; at: string; [key: string]: unknown }
export async function runBuyerAgent(options: {
  model: string; ollamaUrl: string; system: string; prompt: string; history?: ChatMessage[];
  tools: AgentTool[]; signal: AbortSignal; deadline: number;
  onEvent(event: AgentEvent): void; isComplete(): boolean;
  fetchImpl?: typeof fetch;
}) {
  const messages: ChatMessage[] = [
    { role: "system", content: options.system }, ...(options.history ?? []), { role: "user", content: options.prompt },
  ];
  const emit = (type: string, data: Record<string, unknown>) => options.onEvent({ type, at: new Date().toISOString(), ...data });
  const tools = options.tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
  const fetcher = options.fetchImpl ?? fetch;
  for (let turn = 0; turn < 100 && !options.isComplete(); turn++) {
    options.signal.throwIfAborted();
    const started = Date.now();
    const response = await fetcher(`${options.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST", redirect: "error", signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, messages, tools, stream: false, think: false,
        options: { temperature: 0, seed: 42, num_ctx: 16384, num_predict: 4096 } }),
    });
    if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
    const data = await response.json() as { message: ChatMessage; prompt_eval_count?: number; eval_count?: number; load_duration?: number };
    if (data.message?.role !== "assistant") throw new Error("Missing local assistant response");
    messages.push(data.message);
    emit("model", { turn, duration_ms: Date.now() - started, input_tokens: data.prompt_eval_count ?? null,
      output_tokens: data.eval_count ?? null, load_ms: data.load_duration === undefined ? null : data.load_duration / 1e6, message: data.message });
    const calls = data.message.tool_calls ?? [];
    if (!calls.length) { emit("stopped", { reason: "model_finished", complete: options.isComplete() }); return; }
    // Sequential dispatch makes authorization/budget accounting atomic. The posted jobs
    // execute asynchronously on general workers; the model can continue local work.
    for (const call of calls) {
      options.signal.throwIfAborted();
      const tool = options.tools.find((t) => t.name === call.function.name);
      emit("tool_call", { turn, name: call.function.name, arguments: call.function.arguments });
      let result: unknown;
      try {
        if (!tool) throw new Error("Unknown or unavailable tool");
        result = await tool.invoke(call.function.arguments, options.signal);
      } catch (error) {
        if (options.signal.aborted) throw error;
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      emit("tool_result", { turn, name: call.function.name, result });
      messages.push({ role: "tool", tool_name: call.function.name,
        content: JSON.stringify({ result, remaining_seconds: Math.max(0, Math.floor((options.deadline - Date.now()) / 1000)) }) });
      if (options.isComplete()) break;
    }
  }
  emit("stopped", { reason: options.isComplete() ? "all_submitted" : "turn_limit", complete: options.isComplete() });
}
