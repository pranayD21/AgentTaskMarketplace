/**
 * Judge path (runs inside the sandbox).
 *
 * Three rules this module enforces:
 * - Public text is fixed per reason code. Nothing the judge model writes and
 *   no provider response text ever reaches `reason_public` (J1).
 * - A judge-infrastructure failure (provider down, timeout, malformed reply,
 *   refusal) is never a seller rejection: the outcome is `deferred` and no
 *   verdict is submitted, so no strike and no settlement happen (J2).
 * - Every REJECT tries to produce a replacement answer for the buyer and says
 *   explicitly whether one is available (J3).
 * Usage metadata (model, token counts, attempts) is recorded per model call,
 * never content (B1).
 */
import { commitment, fromUtf8, open, seal, type Keypair } from "@atm/crypto";
import { PUBLIC_REASON, JudgePayload, JudgeTaskOutput, ResultPlaintext, type Envelope, type KeyDescriptor, type Rubric, type VerdictReasonCode } from "@atm/shared";
import { withDeadline } from "./deadline.js";
import type { RunnerHost } from "./index.js";

export interface JudgeTaskOpts {
  buyer_public_key: KeyDescriptor;
  judge_model?: string;
  anthropic_url?: string;
  /** The commitment the seller submitted; checked against the decrypted bytes. */
  commitment_sha256?: string;
  /** Model calls per purpose (grade, replacement), including the first. Default 3. */
  max_attempts?: number;
  /** Base backoff between attempts in ms (doubles each retry). Default 1000. */
  retry_backoff_ms?: number;
  /** Deadline per model call in ms. Default 90000. */
  model_timeout_ms?: number;
}

const DEFAULT_JUDGE_MODEL = "claude-opus-5-5";

// Use A's canonical public explanations after the v0.3 contract merge.
export { PUBLIC_REASON } from "@atm/shared";

export type ReplacementStatus = "not_needed" | "available" | "unavailable";

/** One model call's metadata. Unknown values are null, never guessed. */
export interface JudgeUsage {
  purpose: "grade" | "replacement";
  attempt: number;
  model: string;
  outcome: "ok" | string; // failure code otherwise
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export type JudgeOutcome =
  | { kind: "verdict"; output: JudgeTaskOutput; replacement_status: ReplacementStatus; replacement_failure_code: string | null; usage: JudgeUsage[] }
  | { kind: "deferred"; failure_code: string; usage: JudgeUsage[] };

/** A failure of the judge's own infrastructure, never the seller's fault. */
export class JudgeInfraError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}

const verdict = (v: "APPROVE" | "REJECT", reason_code: VerdictReasonCode, score?: number): JudgeTaskOutput =>
  JudgeTaskOutput.parse({ verdict: v, reason_code, reason_public: PUBLIC_REASON[reason_code] ?? "Reviewed by the judge.", ...(score !== undefined ? { score } : {}) });

export async function judge(host: RunnerHost, taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts, judgeKey: Keypair): Promise<JudgeOutcome> {
  const usage: JudgeUsage[] = [];
  // The task copy was sealed by the marketplace; failing to open it is our problem, not the seller's.
  let task: JudgePayload;
  try {
    task = JudgePayload.parse(JSON.parse(fromUtf8(open(judgeKey, taskEnvelope))));
  } catch {
    return { kind: "deferred", failure_code: "JUDGE_PAYLOAD_UNREADABLE", usage };
  }

  const reject = async (code: VerdictReasonCode, score?: number): Promise<JudgeOutcome> => {
    const rep = await replacement(host, opts, task, usage);
    const output = verdict("REJECT", code, score);
    if (rep.envelope) output.replacement_enc_buyer = rep.envelope;
    return { kind: "verdict", output, replacement_status: rep.envelope ? "available" : "unavailable", replacement_failure_code: rep.failure_code, usage };
  };

  // The result copy was sealed by the seller's runner: unreadable or inconsistent bytes are the seller's failure.
  let result: ResultPlaintext;
  try {
    result = ResultPlaintext.parse(JSON.parse(fromUtf8(open(judgeKey, resultEnvelope))));
  } catch {
    return reject("COMMITMENT_MISMATCH");
  }
  if (opts.commitment_sha256 && opts.commitment_sha256 !== commitment(result).sha256_hex) return reject("COMMITMENT_MISMATCH");
  if (result.task_id !== task.task_id) return reject("COMMITMENT_MISMATCH");
  if (!result.answer.trim()) return reject("EMPTY_ANSWER");

  let graded: { pass: boolean; score: number; reason_code: VerdictReasonCode };
  try {
    graded = await grade(host, opts, task.rubric, task, result.answer, usage);
  } catch (err) {
    return { kind: "deferred", failure_code: err instanceof JudgeInfraError ? err.code : "JUDGE_PROVIDER_FAILED", usage };
  }
  if (!graded.pass) return reject(graded.reason_code, graded.score);
  return { kind: "verdict", output: verdict("APPROVE", graded.reason_code, graded.score), replacement_status: "not_needed", replacement_failure_code: null, usage };
}

/**
 * Contract v0.3 infrastructure code for a judge failure (CONTRACT §8.2):
 * the server treats these as deferrals, never as a seller verdict.
 */
export function infraReasonCode(failure: string): "JUDGE_UNAVAILABLE" | "JUDGE_TIMEOUT" | "JUDGE_MALFORMED" {
  if (failure === "JUDGE_MODEL_TIMEOUT") return "JUDGE_TIMEOUT";
  if (failure === "JUDGE_MALFORMED_RESPONSE" || failure === "JUDGE_EMPTY_REPLACEMENT") return "JUDGE_MALFORMED";
  return "JUDGE_UNAVAILABLE";
}

/** J3 retry path: a judge answer for an already-rejected task, sealed to the buyer. */
export async function replacementFor(host: RunnerHost, payloadEnvelope: Envelope, opts: JudgeTaskOpts, judgeKey: Keypair): Promise<{ envelope?: Envelope; failure_code: string | null; usage: JudgeUsage[] }> {
  const usage: JudgeUsage[] = [];
  let task: JudgePayload;
  try {
    task = JudgePayload.parse(JSON.parse(fromUtf8(open(judgeKey, payloadEnvelope))));
  } catch {
    return { failure_code: "JUDGE_PAYLOAD_UNREADABLE", usage };
  }
  return { ...(await replacement(host, opts, task, usage)), usage };
}

async function grade(host: RunnerHost, opts: JudgeTaskOpts, rubric: Rubric, task: JudgePayload, answer: string, usage: JudgeUsage[]) {
  if (rubric.kind === "contains_text") {
    const pass = answer.toLowerCase().includes(rubric.expected_text.toLowerCase());
    return { pass, score: pass ? 1 : 0, reason_code: (pass ? "RUBRIC_MATCH" : "RUBRIC_MISMATCH") as VerdictReasonCode };
  }
  // The model's free-text reasoning is not requested: only the score and pass flag are used.
  const prompt = `You are the judge of an agent marketplace. Grade the worker's answer against the buyer's criteria.\n\nTASK PROMPT:\n${task.prompt}\n${task.context ? `\nCONTEXT:\n${task.context}\n` : ""}\nCRITERIA:\n${rubric.criteria}\n\nWORKER ANSWER:\n${answer}\n\nRespond with JSON only: {"score": <number 0..1>, "pass": <true|false>}`;
  const parsed = await withRetries(host, opts, "grade", usage, async (u) => {
    const text = await anthropic(host, opts, prompt, 300, u);
    const m = /\{[\s\S]*\}/.exec(text);
    let json: { score?: unknown; pass?: unknown };
    try { json = JSON.parse(m ? m[0] : text) as typeof json; } catch { throw new JudgeInfraError("JUDGE_MALFORMED_RESPONSE", true); }
    if (typeof json.pass !== "boolean" && typeof json.score !== "number") throw new JudgeInfraError("JUDGE_MALFORMED_RESPONSE", true);
    return json;
  });
  const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.min(1, Math.max(0, parsed.score)) : parsed.pass ? 1 : 0;
  const pass = typeof parsed.pass === "boolean" ? parsed.pass : score >= 0.7;
  return { pass, score, reason_code: (pass ? "LLM_RUBRIC_PASS" : "LLM_RUBRIC_FAIL") as VerdictReasonCode };
}

async function replacement(host: RunnerHost, opts: JudgeTaskOpts, task: JudgePayload, usage: JudgeUsage[]): Promise<{ envelope?: Envelope; failure_code: string | null }> {
  try {
    const text = await withRetries(host, opts, "replacement", usage, async (u) => {
      const t = await anthropic(host, opts, task.context ? `${task.prompt}\n\n--- context ---\n${task.context}` : task.prompt, 800, u);
      if (!t.trim()) throw new JudgeInfraError("JUDGE_EMPTY_REPLACEMENT", true);
      return t;
    });
    return { envelope: seal(opts.buyer_public_key, new TextEncoder().encode(JSON.stringify({ answer: text, produced_by: "judge" }))), failure_code: null };
  } catch (err) {
    return { failure_code: err instanceof JudgeInfraError ? err.code : "JUDGE_PROVIDER_FAILED" };
  }
}

/** Bounded retries for retryable infrastructure errors; records one usage row per attempt. */
async function withRetries<T>(host: RunnerHost, opts: JudgeTaskOpts, purpose: JudgeUsage["purpose"], usage: JudgeUsage[], call: (u: JudgeUsage) => Promise<T>): Promise<T> {
  const max = Math.max(1, Math.min(opts.max_attempts ?? 3, 5));
  const backoff = opts.retry_backoff_ms ?? 1000;
  for (let attempt = 1; ; attempt++) {
    const u: JudgeUsage = {
      purpose, attempt, model: opts.judge_model ?? DEFAULT_JUDGE_MODEL, outcome: "ok", duration_ms: 0,
      input_tokens: null, output_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null,
    };
    usage.push(u);
    const started = host.now();
    try {
      const out = await call(u);
      u.duration_ms = Math.max(0, Math.round(host.now() - started));
      return out;
    } catch (err) {
      u.duration_ms = Math.max(0, Math.round(host.now() - started));
      const e = err instanceof JudgeInfraError ? err : new JudgeInfraError("JUDGE_PROVIDER_UNREACHABLE", true);
      u.outcome = e.code;
      if (!e.retryable || attempt >= max) throw e;
      await new Promise((r) => setTimeout(r, backoff * 2 ** (attempt - 1)));
    }
  }
}

async function anthropic(host: RunnerHost, opts: JudgeTaskOpts, prompt: string, maxTokens: number, u: JudgeUsage): Promise<string> {
  const key = await host.getSecret("ANTHROPIC_API_KEY");
  if (!key) throw new JudgeInfraError("MISSING_ANTHROPIC_API_KEY", false);
  let res: Response;
  try {
    res = await withDeadline((signal) => host.fetch(`${(opts.anthropic_url ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: opts.judge_model ?? DEFAULT_JUDGE_MODEL, max_tokens: maxTokens + 4000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] }),
    }), opts.model_timeout_ms ?? 90_000, "JUDGE_MODEL_TIMEOUT");
  } catch (err) {
    throw new JudgeInfraError((err as Error)?.message === "JUDGE_MODEL_TIMEOUT" ? "JUDGE_MODEL_TIMEOUT" : "JUDGE_PROVIDER_UNREACHABLE", true);
  }
  // Status only: provider response bodies never leave this function.
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new JudgeInfraError(`JUDGE_PROVIDER_HTTP_${res.status}`, res.status === 429 || res.status === 408 || res.status === 529 || res.status >= 500);
  }
  let json: { model?: string; stop_reason?: string; content?: { type: string; text?: string }[]; usage?: Record<string, unknown> };
  try { json = await res.json() as typeof json; } catch { throw new JudgeInfraError("JUDGE_MALFORMED_RESPONSE", true); }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (typeof json.model === "string") u.model = json.model;
  u.input_tokens = num(json.usage?.input_tokens);
  u.output_tokens = num(json.usage?.output_tokens);
  u.cache_creation_input_tokens = num(json.usage?.cache_creation_input_tokens);
  u.cache_read_input_tokens = num(json.usage?.cache_read_input_tokens);
  if (json.stop_reason === "refusal") throw new JudgeInfraError("JUDGE_PROVIDER_REFUSAL", false);
  return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}
