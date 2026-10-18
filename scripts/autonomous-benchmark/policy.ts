import { createHash } from "node:crypto";

export interface PostRecord { request_id: string; price_cents: number; args: Record<string, unknown>; task_id?: string }
export class BenchmarkPolicy {
  posts: PostRecord[] = [];
  constructor(readonly runId: string, readonly ceiling = 600) {}
  preparePost(input: Record<string, unknown>, remainingSeconds: number) {
    if (remainingSeconds < 45) throw new Error("Too little time remains to post another task");
    const price = input.price_cents ?? input.max_price_cents;
    if (!Number.isSafeInteger(price) || Number(price) < 50 || Number(price) > 100) throw new Error("Task offer must be 50–100 TEST cents");
    if (input.max_price_cents !== undefined && input.max_price_cents !== price) throw new Error("Conflicting task prices");
    if (!Array.isArray(input.allowed_models) || input.allowed_models.length !== 1 || input.allowed_models[0] !== "qwen3:8b") throw new Error("This paired experiment permits qwen3:8b only");
    const rubric = input.rubric as { kind?: string; expected_text?: string } | undefined;
    if (rubric && (rubric.kind !== "contains_text" || rubric.expected_text !== "def ")) throw new Error("Payment acceptance must be contains_text with expected_text 'def '; functional correctness is scored separately");
    if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("A task instruction is required");
    const args = { ...input, price_cents: price, rubric: { kind: "contains_text", expected_text: "def " },
      max_tokens: Math.max(128, Math.min(4096, Number(input.max_tokens) || 2048)),
      max_runtime_s: Math.max(1, Math.min(180, remainingSeconds - 15, Number(input.max_runtime_s) || 180)),
      expires_in_s: Math.floor(remainingSeconds), api_key: undefined };
    const hashInput = { ...args, expires_in_s: undefined, max_runtime_s: input.max_runtime_s ?? 180, client_request_id: undefined };
    const key = `${this.runId}-${createHash("sha256").update(JSON.stringify(hashInput)).digest("hex").slice(0, 16)}`;
    const old = this.posts.find(p => p.request_id === key);
    if (old) return old;
    // Reserve before awaiting I/O; uncertain requests continue to consume the ceiling.
    if (this.posts.reduce((n, p) => n + p.price_cents, 0) + Number(price) > this.ceiling) throw new Error("Experiment spending ceiling reached");
    const record: PostRecord = { request_id: key, price_cents: Number(price), args: { ...args, client_request_id: key } };
    this.posts.push(record);
    return record;
  }
}
