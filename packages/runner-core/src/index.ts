/**
 * Runner core: everything that must execute INSIDE the sandbox.
 *
 * Pure, host-agnostic logic shared by the Wasm component (componentize-js)
 * and the labelled Node fallback. It touches the outside world only through
 * the injected `fetch` and `getSecret`, so the sandbox policy decides what
 * it can reach.
 */
import { commitment, fromUtf8, generateKeypair, keyIdFor, open, randomB64, seal, toB64, type Keypair } from "@atm/crypto";
import {
  JudgeTaskOutput,
  ResultPlaintext,
  RunTaskOutput,
  SellerPayload,
  type Envelope,
  type KeyDescriptor,
} from "@atm/shared";
import { withDeadline } from "./deadline.js";

export { FetchMarketplace, safeFailureCode } from "./marketplace.js";
export { runCycle, type RunCycleOpts, type RunCycleOutput, type SellerRegistration } from "./seller-cycle.js";
export { judgeCycle, type JudgeCycleOpts, type JudgeCycleOutput } from "./judge-cycle.js";
export { judge, JudgeInfraError, PUBLIC_REASON, type JudgeOutcome, type JudgeTaskOpts, type JudgeUsage, type ReplacementStatus } from "./judge.js";
import { judge, type JudgeTaskOpts } from "./judge.js";

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
  expected_task_id?: string;
  expected_claim_id?: string;
}


export interface Runner {
  getPublicKey(): KeyDescriptor;
  runTask(sellerEnvelope: Envelope, opts: RunTaskOpts): Promise<RunTaskOutput>;
  judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts, judgeKey: Keypair): Promise<JudgeTaskOutput>;
}


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
      if ((opts.expected_task_id && opts.expected_task_id !== payload.task_id) ||
          (opts.expected_claim_id && opts.expected_claim_id !== payload.claim_id)) throw new Error("PAYLOAD_CLAIM_MISMATCH");
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
      const outcome = await judge(host, taskEnvelope, resultEnvelope, opts, judgeKey);
      // Infrastructure failures are not verdicts; callers that only want a verdict see a coded error.
      if (outcome.kind === "deferred") throw new Error(outcome.failure_code);
      return outcome.output;
    },
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
  const started = host.now();
  const timeout = opts.timeout_ms ?? 180_000;
  return withDeadline(async (signal) => {
    const inventory = await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/tags`, { signal, redirect: "error" });
    if (!inventory.ok) throw new Error(`OLLAMA_HTTP_${inventory.status}`);
    const installed = await inventory.json() as { models?: { name: string }[] };
    if (signal.aborted || host.now() - started >= timeout) throw new Error("TASK_TIMEOUT");
    if (!installed.models?.some((m) => m.name === opts.model_id)) throw new Error("MODEL_NOT_INSTALLED");
    const res = await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model_id, messages, stream: false, think: false, options: { num_predict: payload.max_tokens, temperature: 0.2 } }),
      signal,
    });
    if (!res.ok) throw new Error(`OLLAMA_HTTP_${res.status}`);
    const json = (await res.json()) as { message?: { content?: string }; eval_count?: number };
    const text = (json.message?.content ?? "").trim();
    if (host.now() - started >= timeout) throw new Error("TASK_TIMEOUT");
    return { text, tokens_out: json.eval_count };
  }, timeout);
}
