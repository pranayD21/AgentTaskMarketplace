/**
 * Runner core: everything that must execute INSIDE the sandbox.
 *
 * Pure, host-agnostic logic shared by the Wasm component (componentize-js)
 * and the labelled Node fallback. It touches the outside world only through
 * the injected `fetch` and `getSecret`, so the sandbox policy decides what
 * it can reach.
 */
import { commitment, fromUtf8, generateKeypair, keyIdFor, keypairFromSecretB64, open, randomB64, seal, toB64, type Keypair } from "@atm/crypto";
import {
  JudgePayload,
  JudgeTaskOutput,
  ResultPlaintext,
  RunTaskOutput,
  SellerPayload,
  type Envelope,
  type KeyDescriptor,
  type Rubric,
} from "@atm/shared";
import { McpFetchClient } from "./mcp.js";

export { McpFetchClient } from "./mcp.js";

export interface RunnerHost {
  fetch: typeof fetch;
  /** Secret lookup (wasi:config/store inside Wassette, process.env in Node). */
  getSecret(name: string): Promise<string | undefined>;
  now(): number;
}

export interface RunTaskOpts {
  ollama_url: string; // e.g. http://localhost:11434
  model_id: string;
  buyer_public_key: KeyDescriptor;
  judge_public_key: KeyDescriptor;
  timeout_ms?: number;
}

export interface JudgeTaskOpts {
  buyer_public_key: KeyDescriptor;
  judge_model?: string;
  anthropic_url?: string;
  /** The commitment the seller submitted; checked against the decrypted bytes. */
  commitment_sha256?: string;
}

export interface Runner {
  getPublicKey(): KeyDescriptor;
  runTask(sellerEnvelope: Envelope, opts: RunTaskOpts): Promise<RunTaskOutput>;
  judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts, judgeKey: Keypair): Promise<JudgeTaskOutput>;
}

// Raw HTTP on purpose: this file also runs inside the Wasm sandbox where the
// Anthropic SDK cannot load; only fetch is available there.
const DEFAULT_JUDGE_MODEL = "claude-opus-5-5";

export function createRunner(host: RunnerHost, existing?: Keypair): Runner {
  // Lazily generated so a build-time snapshot (Wizer) never bakes a key in.
  let kp: Keypair | undefined = existing;
  const keypair = (): Keypair => (kp ??= generateKeypair());

  return {
    getPublicKey() {
      const k = keypair();
      return { key_id: `runner-${keyIdFor(k.publicKey)}`, public_key_b64: toB64(k.publicKey) };
    },

    async runTask(sellerEnvelope, opts) {
      const started = host.now();
      const payload = SellerPayload.parse(JSON.parse(fromUtf8(open(keypair(), sellerEnvelope))));
      const answer = await ollamaChat(host, opts, payload);
      const result: ResultPlaintext = {
        answer: answer.text,
        task_id: payload.task_id,
        claim_id: payload.claim_id,
        model_id: opts.model_id,
        salt_b64: randomB64(32),
      };
      const c = commitment(result);
      return RunTaskOutput.parse({
        result_enc_buyer: seal(opts.buyer_public_key, c.bytes),
        result_enc_judge: seal(opts.judge_public_key, c.bytes),
        commitment_sha256: c.sha256_hex,
        runtime_ms: Math.max(0, Math.round(host.now() - started)),
        model_id: opts.model_id,
        tokens_out: answer.tokens_out,
      });
    },

    async judgeTask(taskEnvelope, resultEnvelope, opts, judgeKey) {
      const task = JudgePayload.parse(JSON.parse(fromUtf8(open(judgeKey, taskEnvelope))));
      const resultBytes = open(judgeKey, resultEnvelope);
      const result = ResultPlaintext.parse(JSON.parse(fromUtf8(resultBytes)));
      // The judge recomputes the commitment over the canonical bytes it decrypted.
      const expected = commitment(result).sha256_hex;
      if (opts.commitment_sha256 && opts.commitment_sha256 !== expected) {
        return JudgeTaskOutput.parse({ verdict: "REJECT", reason_code: "COMMITMENT_MISMATCH", reason_public: "Result does not match the commitment the seller submitted." });
      }
      if (result.task_id !== task.task_id) {
        return JudgeTaskOutput.parse({ verdict: "REJECT", reason_code: "COMMITMENT_MISMATCH", reason_public: "Result was produced for a different task." });
      }
      if (!result.answer.trim()) {
        return JudgeTaskOutput.parse({ verdict: "REJECT", reason_code: "EMPTY_ANSWER", reason_public: "The seller returned an empty answer." , replacement_enc_buyer: await replacement(host, opts, task) });
      }
      const graded = await grade(host, opts, task.rubric, task, result.answer);
      const out: JudgeTaskOutput = {
        verdict: graded.pass ? "APPROVE" : "REJECT",
        reason_code: graded.reason_code,
        reason_public: graded.reason_public,
        score: graded.score,
      };
      if (!graded.pass) out.replacement_enc_buyer = await replacement(host, opts, task);
      return JudgeTaskOutput.parse(out);
    },
  };
}

// ---------------------------------------------------------------------------
// Judge cycle: fetch → judge → submit inside one sandbox instance
// ---------------------------------------------------------------------------

export interface JudgeCycleOpts {
  marketplace_url: string; // e.g. http://localhost:3000/mcp
  judge_model?: string;
  anthropic_url?: string;
}

export type JudgeCycleOutput =
  | { idle: true }
  | { idle: false; task_id: string; result_id: string; verdict: JudgeTaskOutput["verdict"]; reason_code: JudgeTaskOutput["reason_code"]; reason_public: string; score?: number; seller_status: string | null; seller_payout_cents: number | null; settlement_note: string | null };

interface ReviewPackage {
  task_id: string;
  result_id: string;
  payload_enc_judge: Envelope;
  result_enc_judge: Envelope;
  commitment_sha256: string;
  buyer_public_key: KeyDescriptor;
}

/**
 * One full judge round with no host round trip: the agent key, judge private
 * key and model key come from the sandbox's secret store, the marketplace is
 * reached over the sandbox's own network grant, and only the public verdict
 * summary leaves.
 */
export async function judgeCycle(host: RunnerHost, opts: JudgeCycleOpts): Promise<JudgeCycleOutput> {
  const [agentKey, judgeSecret] = await Promise.all([host.getSecret("AGENT_API_KEY"), host.getSecret("JUDGE_PRIVATE_KEY_B64")]);
  if (!agentKey) throw new Error("AGENT_API_KEY is not available inside the judge sandbox");
  if (!judgeSecret) throw new Error("JUDGE_PRIVATE_KEY_B64 is not available inside the judge sandbox");
  const mp = new McpFetchClient(host.fetch, opts.marketplace_url, agentKey);
  const { package: pkg } = await mp.call<{ package: ReviewPackage | null }>("fetch_review_package");
  if (!pkg) return { idle: true };
  const verdict = await createRunner(host).judgeTask(
    pkg.payload_enc_judge,
    pkg.result_enc_judge,
    { buyer_public_key: pkg.buyer_public_key, judge_model: opts.judge_model, anthropic_url: opts.anthropic_url, commitment_sha256: pkg.commitment_sha256 },
    keypairFromSecretB64(judgeSecret),
  );
  const res = await mp.call<{ seller_status: string | null; settlement?: { seller_payout_cents: number; note: string | null } }>("submit_verdict", {
    task_id: pkg.task_id,
    result_id: pkg.result_id,
    verdict: verdict.verdict,
    reason_code: verdict.reason_code,
    reason_public: verdict.reason_public,
    score: verdict.score,
    replacement_enc_buyer: verdict.replacement_enc_buyer,
  });
  return {
    idle: false,
    task_id: pkg.task_id,
    result_id: pkg.result_id,
    verdict: verdict.verdict,
    reason_code: verdict.reason_code,
    reason_public: verdict.reason_public,
    score: verdict.score,
    seller_status: res.seller_status ?? null,
    seller_payout_cents: res.settlement?.seller_payout_cents ?? null,
    settlement_note: res.settlement?.note ?? null,
  };
}

// ---------------------------------------------------------------------------
// Ollama (seller side)
// ---------------------------------------------------------------------------

async function ollamaChat(host: RunnerHost, opts: RunTaskOpts, payload: SellerPayload): Promise<{ text: string; tokens_out?: number }> {
  const messages = [
    { role: "system", content: "You are a worker model executing a task for another agent. Follow the instruction precisely and answer directly without preamble." },
    { role: "user", content: payload.context ? `${payload.prompt}\n\n--- context ---\n${payload.context}` : payload.prompt },
  ];
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller && opts.timeout_ms ? setTimeout(() => controller.abort(), opts.timeout_ms) : undefined;
  try {
    const res = await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model_id, messages, stream: false, think: false, options: { num_predict: payload.max_tokens, temperature: 0.2 } }),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { message?: { content?: string }; eval_count?: number };
    const text = (json.message?.content ?? "").trim();
    return { text, tokens_out: json.eval_count };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Grading (judge side)
// ---------------------------------------------------------------------------

interface Graded { pass: boolean; score: number; reason_code: JudgeTaskOutput["reason_code"]; reason_public: string }

async function grade(host: RunnerHost, opts: JudgeTaskOpts, rubric: Rubric, task: JudgePayload, answer: string): Promise<Graded> {
  if (rubric.kind === "contains_text") {
    const pass = answer.toLowerCase().includes(rubric.expected_text.toLowerCase());
    return pass
      ? { pass, score: 1, reason_code: "RUBRIC_MATCH", reason_public: "Answer contains the buyer's expected text." }
      : { pass, score: 0, reason_code: "RUBRIC_MISMATCH", reason_public: "Answer does not contain the buyer's expected text." };
  }
  const prompt = `You are the judge of an agent marketplace. Grade the worker's answer against the buyer's criteria.\n\nTASK PROMPT:\n${task.prompt}\n${task.context ? `\nCONTEXT:\n${task.context}\n` : ""}\nCRITERIA:\n${rubric.criteria}\n\nWORKER ANSWER:\n${answer}\n\nRespond with JSON only: {"score": <0..1>, "pass": <true|false>, "reason": "<one sentence, no quotes from the task>"}`;
  try {
    const text = await anthropic(host, opts, prompt, 300);
    const m = /\{[\s\S]*\}/.exec(text);
    const parsed = JSON.parse(m ? m[0] : text) as { score?: number; pass?: boolean; reason?: string };
    const score = typeof parsed.score === "number" ? Math.min(1, Math.max(0, parsed.score)) : parsed.pass ? 1 : 0;
    const pass = parsed.pass ?? score >= 0.7;
    return { pass, score, reason_code: pass ? "LLM_RUBRIC_PASS" : "LLM_RUBRIC_FAIL", reason_public: (parsed.reason ?? "Graded by judge model.").slice(0, 300) };
  } catch (err) {
    return { pass: false, score: 0, reason_code: "JUDGE_ERROR", reason_public: `Judge model unavailable: ${(err as Error).message.slice(0, 120)}` };
  }
}

async function replacement(host: RunnerHost, opts: JudgeTaskOpts, task: JudgePayload): Promise<Envelope | undefined> {
  try {
    const text = await anthropic(host, opts, task.context ? `${task.prompt}\n\n--- context ---\n${task.context}` : task.prompt, 800);
    return seal(opts.buyer_public_key, new TextEncoder().encode(JSON.stringify({ answer: text, produced_by: "judge" })));
  } catch {
    return undefined;
  }
}

async function anthropic(host: RunnerHost, opts: JudgeTaskOpts, prompt: string, maxTokens: number): Promise<string> {
  const key = await host.getSecret("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not available to the judge sandbox");
  const res = await host.fetch(`${(opts.anthropic_url ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: opts.judge_model ?? DEFAULT_JUDGE_MODEL, max_tokens: maxTokens + 4000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (json.stop_reason === "refusal") throw new Error("judge model declined the request (refusal)");
  return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}
