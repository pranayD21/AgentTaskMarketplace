import { generateKeypair, keyIdFor, open, sealJson, toB64 } from "@atm/crypto";
import { createRunner, type RunnerHost } from "./index.js";
import { runCycle, type RunCycleOpts, type RunCycleOutput } from "./seller-cycle.js";
import { safeFailureCode } from "./marketplace.js";

/** Counts and durations reported by the local provider; never task text. */
export interface SellerUsage {
  source: "ollama";
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  total_duration_ms: number | null;
  load_duration_ms: number | null;
  prompt_eval_duration_ms: number | null;
  eval_duration_ms: number | null;
}
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const count = (v: unknown): number | null => Number.isSafeInteger(v) && numeric(v) !== null ? v as number : null;
const ms = (v: unknown): number | null => numeric(v) === null ? null : (v as number) / 1_000_000;

export function ollamaUsage(value: Record<string, unknown>): SellerUsage {
  return { source: "ollama", input_tokens: count(value.prompt_eval_count), output_tokens: count(value.eval_count), cached_input_tokens: count(value.prompt_eval_cached_count),
    total_duration_ms: ms(value.total_duration), load_duration_ms: ms(value.load_duration),
    prompt_eval_duration_ms: ms(value.prompt_eval_duration), eval_duration_ms: ms(value.eval_duration) };
}

/** An allowlist also protects the host if a component returns extra fields. */
export function safeSellerUsage(value: unknown): SellerUsage | null {
  if (!value || typeof value !== "object" || (value as { source?: unknown }).source !== "ollama") return null;
  const v = value as Record<string, unknown>;
  return { source: "ollama", input_tokens: count(v.input_tokens), output_tokens: count(v.output_tokens), cached_input_tokens: count(v.cached_input_tokens),
    total_duration_ms: numeric(v.total_duration_ms), load_duration_ms: numeric(v.load_duration_ms),
    prompt_eval_duration_ms: numeric(v.prompt_eval_duration_ms), eval_duration_ms: numeric(v.eval_duration_ms) };
}

export type MeasuredCycleOutput =
  | { ok: true; result: RunCycleOutput; seller_usage: SellerUsage | null }
  | { ok: false; error_code: string; seller_usage: SellerUsage | null };

/** Retain completed inference usage even if a later submission fails. */
export async function measuredCycle(host: RunnerHost, opts: RunCycleOpts): Promise<MeasuredCycleOutput> {
  let usage: SellerUsage | null = null;
  const observed = { ...host, onSellerUsage: (value: SellerUsage) => { usage = safeSellerUsage(value); } };
  try { return { ok: true, result: await runCycle(observed, opts), seller_usage: usage }; }
  catch (error) { return { ok: false, error_code: safeFailureCode(error), seller_usage: usage }; }
}

export interface CanaryOpts { ollama_url: string; model_id: string; timeout_ms?: number }
export interface CanaryOutput { passed: boolean; runtime_ms: number; seller_usage: SellerUsage | null }

/** Fixed synthetic inference inside the runner; creates no marketplace task. */
export async function modelCanary(host: RunnerHost, opts: CanaryOpts): Promise<CanaryOutput> {
  const timeout = opts.timeout_ms ?? 60_000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 180_000) throw new Error("INVALID_RUNTIME_LIMIT");
  const runner = createRunner(host);
  const recipient = generateKeypair();
  const key = { key_id: `canary-${keyIdFor(recipient.publicKey)}`, public_key_b64: toB64(recipient.publicKey) };
  const envelope = sealJson(runner.getPublicKey(), {
    task_id: "task_local_canary", claim_id: "claim_local_canary", model_id: opts.model_id,
    prompt: "What is 2 + 2? Reply with the single digit only.", max_tokens: 8,
  });
  const out = await runner.runTask(envelope, {
    ollama_url: opts.ollama_url, model_id: opts.model_id, buyer_public_key: key, judge_public_key: key, timeout_ms: timeout, agent_mode:false,
  });
  const result = JSON.parse(new TextDecoder().decode(open(recipient, out.result_enc_buyer))) as { answer?: unknown };
  return { passed: result.answer === "4", runtime_ms: out.runtime_ms, seller_usage: out.seller_usage ?? null };
}
